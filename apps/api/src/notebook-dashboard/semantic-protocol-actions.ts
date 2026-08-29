/**
 * Semantic protocol action implementations.
 *
 * These functions implement the `semantic.context.resolve` and
 * `analysis.contract.ground` actions that the data-analysis protocol calls
 * during the `semantic_grounding` phase.
 *
 * They bridge the gap between the protocol state machine and the
 * semantic catalog repository + grounder.
 *
 * Action result shapes match what `reduceDataAnalysisAction` in
 * `data-analysis.ts` expects.
 */
import type { LocalDataGateway } from "@agentx/data-gateway";

import { SemanticCatalogRepository } from "./semantic-catalog.js";
import { groundDatasourceSchema, inferSemanticTypes, inferGlossaryTerms, type PhysicalSchema } from "./semantic-grounder.js";
import type { ColumnExpectation, RequirementBinding } from "./semantic-catalog.js";

export interface SemanticContextResolveInput {
  workspaceId: string;
  datasourceId: string;
  /** If provided, prefer this catalog over auto-detected ones. */
  catalogId?: string;
  /** If true, write inferred descriptions back to the catalog. */
  autoWriteToCatalog?: boolean;
  /** Optional LLM bridge for enhanced semantic inference. */
  llmBridge?: (prompt: string) => Promise<string>;
}

export interface SemanticContextResolveResult {
  mode: "catalog" | "inferred" | "unavailable";
  trust: "high" | "medium" | "low";
  datasourceRevision: string;
  catalogId?: string;
  columnsInferred: number;
  glossaryTermsInferred: number;
  warnings: string[];
}

/**
 * Implements `semantic.context.resolve`.
 *
 * Resolution order:
 *   1. If a catalog exists for this workspace × datasource, use it.
 *   2. Else, infer from physical schema via the grounder.
 *   3. If inference confidence is low, mark as unavailable.
 *
 * The returned result shape satisfies what `reduceDataAnalysisAction`
 * reads from the action result (mode, trust, datasourceRevision, warnings).
 */
export async function resolveSemanticContext(
  input: SemanticContextResolveInput,
  gateway: LocalDataGateway,
  repo: SemanticCatalogRepository,
): Promise<SemanticContextResolveResult> {
  const { workspaceId, datasourceId, autoWriteToCatalog = false, llmBridge } = input;

  // Step 1: Try to load existing catalog
  const ctx = repo.resolveSemanticContext(workspaceId, datasourceId);

  if (ctx.catalog && ctx.columns.length > 0) {
    // Catalog available — trust it
    const avgConfidence = ctx.columns.reduce((s, c) =>
      c.semanticType ? s + 0.8 : s + 0.3, 0) / Math.max(ctx.columns.length, 1);
    const trust = avgConfidence >= 0.75 ? "high" : avgConfidence >= 0.5 ? "medium" : "low";
    return {
      mode: "catalog",
      trust,
      datasourceRevision: `catalog_${ctx.catalog.revision}`,
      catalogId: ctx.catalog.id,
      columnsInferred: ctx.columns.length,
      glossaryTermsInferred: ctx.glossary.length,
      warnings: [],
    };
  }

  // Step 2: No catalog — infer from physical schema
  const physicalSchema = await fetchPhysicalSchema(gateway, datasourceId, workspaceId);
  if (physicalSchema.tables.length === 0) {
    return {
      mode: "unavailable",
      trust: "low",
      datasourceRevision: "none",
      columnsInferred: 0,
      glossaryTermsInferred: 0,
      warnings: ["No catalog and datasource returned empty schema. Check the datasource connection."],
    };
  }

  // Run the inference engine
  const grounding = await groundDatasourceSchema(physicalSchema, datasourceId, {
    gateway,
    ...(autoWriteToCatalog ? { writeToCatalog: true } : {}),
    ...(ctx.catalog?.id !== undefined ? { catalogId: ctx.catalog.id } : {}),
  });

  // Step 3: Optionally enhance with LLM (if bridge is available)
  if (llmBridge && grounding.trust === "low") {
    const enhanced = await enhanceWithLLM(grounding, llmBridge);
    if (enhanced) return {
      ...grounding,
      columnsInferred: grounding.columns.length,
      glossaryTermsInferred: grounding.glossary.length,
      warnings: [...grounding.warnings, ...enhanced.warnings]
    };
  }

  return {
    mode: grounding.mode,
    trust: grounding.trust,
    datasourceRevision: grounding.datasourceRevision,
    ...(grounding.catalogId !== undefined ? { catalogId: grounding.catalogId } : {}),
    columnsInferred: grounding.columns.length,
    glossaryTermsInferred: grounding.glossary.length,
    warnings: grounding.warnings,
  };
}

async function fetchPhysicalSchema(gateway: LocalDataGateway, datasourceId: string, workspaceId?: string): Promise<PhysicalSchema> {
  try {
    const result = await gateway.inspectSchema({
      datasource_id: datasourceId,
      user_id: "",
      workspace_id: workspaceId ?? undefined,
    } as unknown as Parameters<typeof gateway.inspectSchema>[0]);
    // Result shape from LocalDataGateway — adapt to our PhysicalSchema
    return adaptSchema(result);
  } catch (err) {
    console.error("[semantic-protocol] inspectSchema failed:", err);
    return { tables: [] };
  }
}

function adaptSchema(raw: unknown): PhysicalSchema {
  // The gateway returns { schema_id, dialect, tables: [{ name, columns: [...] }] }
  const r = raw as Record<string, unknown>;
  if (!r || !Array.isArray(r.tables)) return { tables: [] };
  const tables = (r.tables as Array<Record<string, unknown>>).map((t) => ({
    name: String(t.name ?? ""),
    columns: (Array.isArray(t.columns) ? t.columns : []) as import("./semantic-grounder.js").PhysicalColumn[],
  }));
  return { tables };
}

// ─────────────────────────────────────────────────────────────────────────────
// analysis.contract.ground
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalysisContractGroundInput {
  workspaceId: string;
  datasourceId: string;
  /** Requirements the user specified for this analysis. */
  userRequirements: Array<{ id: string; label: string; description?: string }>;
  /** Column descriptions from the semantic context. */
  columnDescriptions: Array<{ tableName: string; columnName: string; semanticType: string; description: string }>;
  /** Glossary terms. */
  glossaryTerms: Array<{ term: string; definition: string; businessType: string }>;
  /** Optional data contracts. */
  contracts: Array<{ tableName: string; expectations: Record<string, ColumnExpectation> }>;
}

export interface ContractGroundFinding {
  requirementId: string;
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface AnalysisContractGroundResult {
  requirements: Array<{
    id: string;
    tableName: string;
    columnName: string;
    semanticType: string;
    bindingType: "column" | "aggregate";
    sqlSnippet: string;
    confidence: number;
  }>;
  findings: ContractGroundFinding[];
  datasourceRevision: string;
}

/**
 * Implements `analysis.contract.ground`.
 *
 * For each user requirement, the function:
 *   1. Parses the requirement label/description to extract business terms
 *   2. Matches those terms against glossary entries and column descriptions
 *   3. Produces a RequirementBinding with a SQL snippet
 *   4. Reports any grounding findings (unmatched terms, ambiguous matches, etc.)
 *
 * The returned requirements shape matches what the protocol expects in the
 * `contractGrounded` state transition.
 */
export async function groundAnalysisContract(
  input: AnalysisContractGroundInput,
  repo: SemanticCatalogRepository,
): Promise<AnalysisContractGroundResult> {
  const { workspaceId, datasourceId, userRequirements, columnDescriptions, glossaryTerms, contracts } = input;
  const findings: ContractGroundFinding[] = [];
  const groundedRequirements: AnalysisContractGroundResult["requirements"] = [];

  // Build lookup maps
  const glossaryMap = new Map<string, typeof glossaryTerms[0]>();
  for (const t of glossaryTerms) glossaryMap.set(t.term.toLowerCase(), t);

  const columnMap = new Map<string, typeof columnDescriptions[0]>();
  for (const c of columnDescriptions) {
    columnMap.set(`${c.tableName}.${c.columnName}`.toLowerCase(), c);
    columnMap.set(c.columnName.toLowerCase(), c);
  }

  for (const req of userRequirements) {
    // Step 1: Extract keywords from the requirement label
    const keywords = extractKeywords(req.label + " " + (req.description ?? ""));

    // Step 2: Try exact glossary matches first
    let bestMatch: typeof columnDescriptions[0] | null = null;
    let bestConfidence = 0;
    let matchedTerm = "";

    for (const kw of keywords) {
      const term = glossaryMap.get(kw.toLowerCase());
      if (!term) continue;

      // Find columns bound to this term
      const termBindings = repo.listRequirementBindingsByCatalog(req.id).filter(
        (b) => b.requirementId === req.id,
      );
      if (termBindings.length > 0) {
        const col = columnMap.get(termBindings[0]!.columnName.toLowerCase());
        if (col && 0.9 > bestConfidence) {
          bestMatch = col;
          bestConfidence = 0.9;
          matchedTerm = term.term;
        }
      }
    }

    // Step 3: Fuzzy column name matching
    if (!bestMatch) {
      for (const kw of keywords) {
        for (const col of columnDescriptions) {
          const colName = col.columnName.toLowerCase();
          const fullKey = `${col.tableName}.${colName}`;
          if (colName.includes(kw.toLowerCase()) || fullKey.includes(kw.toLowerCase())) {
            const confidence = kw.length / Math.max(colName.length, kw.length);
            if (confidence > bestConfidence && confidence > 0.5) {
              bestMatch = col;
              bestConfidence = Math.round(confidence * 0.7 * 100) / 100;
            }
          }
        }
      }
    }

    if (!bestMatch) {
      findings.push({
        requirementId: req.id,
        code: "UNMATCHED_REQUIREMENT",
        message: `No column matched for requirement "${req.label}". Check your column descriptions in the catalog.`,
        severity: "warning",
      });
      continue;
    }

    // Step 4: Determine binding type
    const isAggregate = /\b(sum|total|count|avg|mean|max|min|distinct)\b/i.test(req.label);
    const sqlSnippet = isAggregate
      ? `SUM(${bestMatch.tableName}.${bestMatch.columnName})`
      : `${bestMatch.tableName}.${bestMatch.columnName}`;

    groundedRequirements.push({
      id: req.id,
      tableName: bestMatch.tableName,
      columnName: bestMatch.columnName,
      semanticType: bestMatch.semanticType,
      bindingType: isAggregate ? "aggregate" : "column",
      sqlSnippet,
      confidence: bestConfidence,
    });
  }

  // Step 5: Validate against data contracts
  // Note: catalogId is not available in this context; contract validation is skipped.
  // To re-enable, pass catalogId from the caller's SemanticContextResolveResult.
  void repo;
  void contracts;

  const datasourceRevision = `grounded_${Date.now()}`;
  return { requirements: groundedRequirements, findings, datasourceRevision };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractKeywords(text: string): string[] {
  // Extract meaningful words (≥3 chars, no stop words)
  const STOP = new Set([
    "the", "a", "an", "of", "in", "on", "at", "to", "for", "by",
    "and", "or", "with", "from", "is", "are", "was", "were", "be",
    "been", "being", "have", "has", "had", "do", "does", "did",
    "will", "would", "should", "could", "may", "might", "must",
    "can", "need", "want", "get", "show", "find", "list", "total",
    "all", "each", "per", "what", "which", "who", "whose", "how",
    "many", "much", "some", "any", "every", "no", "not", "only",
  ]);
  return text
    .replace(/[^a-zA-Z0-9_\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

interface LLMEnhancement {
  warnings: string[];
}

async function enhanceWithLLM(
  grounding: import("./semantic-grounder.js").GroundingResult,
  llmBridge: (prompt: string) => Promise<string>,
): Promise<LLMEnhancement | null> {
  try {
    const prompt = `Given these inferred semantic types for a database schema, suggest corrections:
${grounding.columns.slice(0, 10).map((c) => `${c.tableName}.${c.columnName} → ${c.inferredSemanticType} (${c.confidence})`).join("\n")}
Respond with a JSON array of {column, suggestedType, reason} for any corrections needed.`;
    const response = await llmBridge(prompt);
    // Basic response parsing — in production, use structured JSON output
    if (response && response.length > 10) {
      return { warnings: ["LLM enhancement available but not yet integrated — requires structured JSON output."] };
    }
    return null;
  } catch {
    return null;
  }
}
