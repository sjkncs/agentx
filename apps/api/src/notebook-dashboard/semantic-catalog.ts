/**
 * Data access layer for the semantic catalog.
 *
 * Handles all CRUD operations for:
 *   - Catalogs (workspace × datasource metadata collections)
 *   - Column descriptions (semantic type + description per column)
 *   - Glossary terms + term → column bindings
 *   - Data contracts (schema-level expectations)
 *   - Requirement bindings (requirement → catalog entity links)
 *
 * All writes are wrapped in transactions so concurrent updates never corrupt data.
 */
import { randomUUID } from "node:crypto";

import { ensureSemanticCatalogSchema } from "./semantic-schema.js";

export class SemanticCatalogError extends Error {
  readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID_ARGUMENT" | "INTERNAL";
  constructor(code: SemanticCatalogError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Row types (SQLite row → domain object)
// ─────────────────────────────────────────────────────────────────────────────

interface CatalogRow {
  id: string; workspace_id: string; datasource_id: string;
  name: string; description: string; version: string; revision: string;
  created_at: string; updated_at: string;
}
interface ColumnDescRow {
  id: string; catalog_id: string; table_name: string; column_name: string;
  description: string; semantic_type: string; data_type: string;
  nullable: number; sample_values: string; created_at: string; updated_at: string;
}
interface GlossaryTermRow {
  id: string; catalog_id: string; term: string;
  definition: string; business_type: string; created_at: string; updated_at: string;
}
interface TermBindingRow {
  id: string; term_id: string; column_desc_id: string;
  confidence: number; created_at: string;
}
interface DataContractRow {
  id: string; catalog_id: string; table_name: string; version: string;
  description: string; expectations: string; created_at: string; updated_at: string;
}
interface RequirementBindingRow {
  id: string; catalog_id: string; requirement_id: string;
  requirement_label: string; datasource_id: string; table_name: string;
  column_name: string; binding_type: string; sql_snippet: string;
  confidence: number; created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain types (public API shape)
// ─────────────────────────────────────────────────────────────────────────────

export interface SemanticCatalog {
  id: string; workspaceId: string; datasourceId: string;
  name: string; description: string; version: string; revision: string;
  createdAt: string; updatedAt: string;
}
export interface ColumnDescription {
  id: string; catalogId: string; tableName: string; columnName: string;
  description: string; semanticType: string; dataType: string;
  nullable: boolean; sampleValues: string[];
  createdAt: string; updatedAt: string;
}
export interface GlossaryTerm {
  id: string; catalogId: string; term: string;
  definition: string; businessType: string;
  createdAt: string; updatedAt: string;
}
export interface TermBinding {
  id: string; termId: string; columnDescId: string;
  confidence: number; createdAt: string;
}
export interface DataContract {
  id: string; catalogId: string; tableName: string;
  version: string; description: string;
  expectations: Record<string, ColumnExpectation>;
  createdAt: string; updatedAt: string;
}
export interface ColumnExpectation {
  notNull?: boolean;
  min?: number; max?: number;
  regex?: string | null;
  allowedValues?: string[];
}
export interface RequirementBinding {
  id: string; catalogId: string; requirementId: string;
  requirementLabel: string; datasourceId: string; tableName: string;
  columnName: string; bindingType: "column" | "aggregate" | "join";
  sqlSnippet: string; confidence: number; createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

import type { Database as BetterSqlite3Database, Statement } from "better-sqlite3";

export class SemanticCatalogRepository {
  private readonly s: {
    insertCatalog: Statement; updateCatalog: Statement;
    getCatalog: Statement; listCatalogs: Statement; deleteCatalog: Statement;
    insertColumnDesc: Statement; updateColumnDesc: Statement;
    getColumnDesc: Statement; findColumnDescByKey: Statement; listColumnDescs: Statement;
    listColumnDescsByTable: Statement; deleteColumnDesc: Statement;
    insertGlossaryTerm: Statement; updateGlossaryTerm: Statement;
    getGlossaryTerm: Statement; listGlossaryTerms: Statement;
    deleteGlossaryTerm: Statement;
    insertTermBinding: Statement; deleteTermBinding: Statement;
    listTermBindingsByTerm: Statement; listTermBindingsByCol: Statement;
    insertDataContract: Statement; updateDataContract: Statement;
    getDataContract: Statement; listDataContracts: Statement;
    upsertRequirementBinding: Statement;
    listRequirementBindings: Statement;
    listRequirementBindingsByReq: Statement;
    listRequirementBindingsByCatalog: Statement;
  };

  constructor(private readonly db: BetterSqlite3Database) {
    ensureSemanticCatalogSchema(db);
    const d = db;

    this.s = {
      insertCatalog: d.prepare(`INSERT INTO sem_catalogs
        (id,workspace_id,datasource_id,name,description,version,revision,created_at,updated_at)
        VALUES (@id,@workspace_id,@datasource_id,@name,@description,@version,@revision,@created_at,@updated_at)`),

      updateCatalog: d.prepare(`UPDATE sem_catalogs SET
        name=@name, description=@description, revision=@revision, updated_at=@updated_at
        WHERE id=@id AND workspace_id=@workspace_id`),

      getCatalog: d.prepare("SELECT * FROM sem_catalogs WHERE id=? AND workspace_id=?"),
      listCatalogs: d.prepare("SELECT * FROM sem_catalogs WHERE workspace_id=? ORDER BY updated_at DESC"),
      deleteCatalog: d.prepare("DELETE FROM sem_catalogs WHERE id=? AND workspace_id=?"),

      insertColumnDesc: d.prepare(`INSERT INTO sem_column_descs
        (id,catalog_id,table_name,column_name,description,semantic_type,data_type,nullable,sample_values,created_at,updated_at)
        VALUES (@id,@catalog_id,@table_name,@column_name,@description,@semantic_type,@data_type,@nullable,@sample_values,@created_at,@updated_at)
        ON CONFLICT(catalog_id,table_name,column_name) DO UPDATE SET
          id=excluded.id, description=excluded.description, semantic_type=excluded.semantic_type,
          data_type=excluded.data_type, nullable=excluded.nullable, sample_values=excluded.sample_values,
          updated_at=excluded.updated_at`),

      updateColumnDesc: d.prepare(`UPDATE sem_column_descs SET
        description=@description, semantic_type=@semantic_type, updated_at=@updated_at
        WHERE id=@id`),

      getColumnDesc: d.prepare("SELECT * FROM sem_column_descs WHERE id=?"),
      findColumnDescByKey: d.prepare("SELECT * FROM sem_column_descs WHERE catalog_id=? AND table_name=? AND column_name=? LIMIT 1"),
      listColumnDescs: d.prepare("SELECT * FROM sem_column_descs WHERE catalog_id=? ORDER BY table_name,column_name"),
      listColumnDescsByTable: d.prepare("SELECT * FROM sem_column_descs WHERE catalog_id=? AND table_name=? ORDER BY column_name"),
      deleteColumnDesc: d.prepare("DELETE FROM sem_column_descs WHERE id=?"),

      insertGlossaryTerm: d.prepare(`INSERT INTO sem_glossary_terms
        (id,catalog_id,term,definition,business_type,created_at,updated_at)
        VALUES (@id,@catalog_id,@term,@definition,@business_type,@created_at,@updated_at)`),

      updateGlossaryTerm: d.prepare(`UPDATE sem_glossary_terms SET
        definition=@definition, business_type=@business_type, updated_at=@updated_at
        WHERE id=@id`),

      getGlossaryTerm: d.prepare("SELECT * FROM sem_glossary_terms WHERE id=?"),
      listGlossaryTerms: d.prepare("SELECT * FROM sem_glossary_terms WHERE catalog_id=? ORDER BY term"),
      deleteGlossaryTerm: d.prepare("DELETE FROM sem_glossary_terms WHERE id=?"),

      insertTermBinding: d.prepare(`INSERT INTO sem_term_bindings
        (id,term_id,column_desc_id,confidence,created_at)
        VALUES (@id,@term_id,@column_desc_id,@confidence,@created_at)
        ON CONFLICT(term_id,column_desc_id) DO UPDATE SET confidence=@confidence`),

      deleteTermBinding: d.prepare("DELETE FROM sem_term_bindings WHERE id=?"),
      listTermBindingsByTerm: d.prepare("SELECT * FROM sem_term_bindings WHERE term_id=?"),
      listTermBindingsByCol: d.prepare("SELECT * FROM sem_term_bindings WHERE column_desc_id=?"),

      insertDataContract: d.prepare(`INSERT INTO sem_data_contracts
        (id,catalog_id,table_name,version,description,expectations,created_at,updated_at)
        VALUES (@id,@catalog_id,@table_name,@version,@description,@expectations,@created_at,@updated_at)`),

      updateDataContract: d.prepare(`UPDATE sem_data_contracts SET
        description=@description, expectations=@expectations, version=@version, updated_at=@updated_at
        WHERE id=@id`),

      getDataContract: d.prepare("SELECT * FROM sem_data_contracts WHERE id=?"),
      listDataContracts: d.prepare("SELECT * FROM sem_data_contracts WHERE catalog_id=? ORDER BY table_name"),

      upsertRequirementBinding: d.prepare(`INSERT INTO sem_requirement_bindings
        (id,catalog_id,requirement_id,requirement_label,datasource_id,table_name,column_name,binding_type,sql_snippet,confidence,created_at)
        VALUES (@id,@catalog_id,@requirement_id,@requirement_label,@datasource_id,@table_name,@column_name,@binding_type,@sql_snippet,@confidence,@created_at)
        ON CONFLICT(id) DO UPDATE SET
          requirement_label=@requirement_label, column_name=@column_name,
          binding_type=@binding_type, sql_snippet=@sql_snippet, confidence=@confidence`),

      listRequirementBindings: d.prepare("SELECT * FROM sem_requirement_bindings ORDER BY created_at"),
      listRequirementBindingsByReq: d.prepare("SELECT * FROM sem_requirement_bindings WHERE requirement_id=?"),
      listRequirementBindingsByCatalog: d.prepare("SELECT * FROM sem_requirement_bindings WHERE catalog_id=?"),
    };
  }

  private rowToCatalog(r: CatalogRow): SemanticCatalog {
    return {
      id: r.id, workspaceId: r.workspace_id, datasourceId: r.datasource_id,
      name: r.name, description: r.description, version: r.version, revision: r.revision,
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
  private rowToColumnDesc(r: ColumnDescRow): ColumnDescription {
    return {
      id: r.id, catalogId: r.catalog_id, tableName: r.table_name, columnName: r.column_name,
      description: r.description, semanticType: r.semantic_type, dataType: r.data_type,
      nullable: r.nullable !== 0,
      sampleValues: safeJsonParse<string[]>(r.sample_values, []),
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
  private rowToGlossaryTerm(r: GlossaryTermRow): GlossaryTerm {
    return {
      id: r.id, catalogId: r.catalog_id, term: r.term,
      definition: r.definition, businessType: r.business_type,
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
  private rowToTermBinding(r: TermBindingRow): TermBinding {
    return { id: r.id, termId: r.term_id, columnDescId: r.column_desc_id, confidence: r.confidence, createdAt: r.created_at };
  }
  private rowToDataContract(r: DataContractRow): DataContract {
    return {
      id: r.id, catalogId: r.catalog_id, tableName: r.table_name, version: r.version,
      description: r.description,
      expectations: safeJsonParse<Record<string, ColumnExpectation>>(r.expectations, {}),
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
  private rowToRequirementBinding(r: RequirementBindingRow): RequirementBinding {
    return {
      id: r.id, catalogId: r.catalog_id, requirementId: r.requirement_id,
      requirementLabel: r.requirement_label, datasourceId: r.datasource_id,
      tableName: r.table_name, columnName: r.column_name,
      bindingType: r.binding_type as RequirementBinding["bindingType"],
      sqlSnippet: r.sql_snippet, confidence: r.confidence, createdAt: r.created_at,
    };
  }

  // ── Catalogs ──────────────────────────────────────────────────────────────

  createCatalog(input: {
    workspaceId: string; datasourceId: string; name: string; description?: string;
  }): SemanticCatalog {
    const id = `cat-${randomUUID()}`;
    const now = new Date().toISOString();
    const row: CatalogRow = {
      id, workspace_id: input.workspaceId, datasource_id: input.datasourceId,
      name: input.name, description: input.description ?? "",
      version: "1", revision: "0", created_at: now, updated_at: now,
    };
    this.s.insertCatalog.run(row);
    return this.rowToCatalog(row);
  }

  updateCatalog(input: {
    workspaceId: string; catalogId: string; name?: string; description?: string;
  }): SemanticCatalog {
    const existing = this.getCatalog(input.workspaceId, input.catalogId);
    if (!existing) throw new SemanticCatalogError("NOT_FOUND", `catalog ${input.catalogId} not found`);
    const now = new Date().toISOString();
    const rev = String(Number(existing.revision) + 1);
    this.s.updateCatalog.run({
      id: existing.id, workspace_id: existing.workspaceId,
      name: input.name ?? existing.name, description: input.description ?? existing.description,
      revision: rev, updated_at: now,
    });
    return { ...existing, name: input.name ?? existing.name, description: input.description ?? existing.description, revision: rev, updatedAt: now };
  }

  getCatalog(workspaceId: string, catalogId: string): SemanticCatalog | null {
    const r = this.s.getCatalog.get(catalogId, workspaceId) as CatalogRow | undefined;
    return r ? this.rowToCatalog(r) : null;
  }

  listCatalogs(workspaceId: string): SemanticCatalog[] {
    const rows = this.s.listCatalogs.all(workspaceId) as CatalogRow[];
    return rows.map(this.rowToCatalog);
  }

  deleteCatalog(workspaceId: string, catalogId: string): boolean {
    return this.s.deleteCatalog.run(catalogId, workspaceId).changes > 0;
  }

  // ── Column descriptions ────────────────────────────────────────────────────

  upsertColumnDesc(input: {
    catalogId: string; tableName: string; columnName: string;
    description?: string; semanticType?: string; dataType?: string;
    nullable?: boolean; sampleValues?: string[];
  }): ColumnDescription {
    const now = new Date().toISOString();
    const existing = this.s.findColumnDescByKey.get(
      input.catalogId, input.tableName, input.columnName,
    ) as ColumnDescRow | undefined;

    // For partial updates, default unspecified fields to the existing row's values
    // so we never accidentally wipe a previously-stored semanticType or description.
    const id = existing?.id ?? `cd-${randomUUID()}`;
    const description = input.description ?? existing?.description ?? "";
    const semanticType = input.semanticType ?? existing?.semantic_type ?? "";
    const dataType = input.dataType ?? existing?.data_type ?? "";
    const nullable = input.nullable !== undefined
      ? (input.nullable ? 1 : 0)
      : (existing?.nullable ?? 1);
    const sampleValues = input.sampleValues ?? (existing ? safeJsonParse(existing.sample_values, []) : []);

    this.s.insertColumnDesc.run({
      id, catalog_id: input.catalogId, table_name: input.tableName,
      column_name: input.columnName, description, semantic_type: semanticType,
      data_type: dataType, nullable, sample_values: JSON.stringify(sampleValues),
      created_at: existing?.created_at ?? now, updated_at: now,
    });
    const r = this.s.findColumnDescByKey.get(input.catalogId, input.tableName, input.columnName) as ColumnDescRow | undefined;
    if (!r) throw new SemanticCatalogError("INTERNAL", "failed to upsert column desc");
    return this.rowToColumnDesc(r);
  }

  listColumnDescs(catalogId: string): ColumnDescription[] {
    return (this.s.listColumnDescs.all(catalogId) as ColumnDescRow[]).map(this.rowToColumnDesc);
  }

  listColumnDescsByTable(catalogId: string, tableName: string): ColumnDescription[] {
    return (this.s.listColumnDescsByTable.all(catalogId, tableName) as ColumnDescRow[]).map(this.rowToColumnDesc);
  }

  deleteColumnDesc(id: string): boolean {
    return this.s.deleteColumnDesc.run(id).changes > 0;
  }

  // ── Glossary terms ──────────────────────────────────────────────────────

  createGlossaryTerm(input: {
    catalogId: string; term: string; definition?: string; businessType?: string;
  }): GlossaryTerm {
    const id = `term-${randomUUID()}`;
    const now = new Date().toISOString();
    this.s.insertGlossaryTerm.run({
      id, catalog_id: input.catalogId, term: input.term,
      definition: input.definition ?? "", business_type: input.businessType ?? "",
      created_at: now, updated_at: now,
    });
    const r = this.s.getGlossaryTerm.get(id) as GlossaryTermRow | undefined;
    if (!r) throw new SemanticCatalogError("INTERNAL", "failed to create glossary term");
    return this.rowToGlossaryTerm(r);
  }

  updateGlossaryTerm(input: {
    id: string; definition?: string; businessType?: string;
  }): GlossaryTerm {
    const existing = this.s.getGlossaryTerm.get(input.id) as GlossaryTermRow | undefined;
    if (!existing) throw new SemanticCatalogError("NOT_FOUND", `glossary term ${input.id} not found`);
    const now = new Date().toISOString();
    this.s.updateGlossaryTerm.run({
      id: input.id, definition: input.definition ?? existing.definition,
      business_type: input.businessType ?? existing.business_type, updated_at: now,
    });
    return { ...this.rowToGlossaryTerm(existing), definition: input.definition ?? existing.definition, businessType: input.businessType ?? existing.business_type, updatedAt: now };
  }

  listGlossaryTerms(catalogId: string): GlossaryTerm[] {
    return (this.s.listGlossaryTerms.all(catalogId) as GlossaryTermRow[]).map(this.rowToGlossaryTerm);
  }

  deleteGlossaryTerm(id: string): boolean {
    return this.s.deleteGlossaryTerm.run(id).changes > 0;
  }

  // ── Term bindings ────────────────────────────────────────────────────────

  bindTermToColumn(input: { termId: string; columnDescId: string; confidence?: number }): TermBinding {
    const id = `tb-${randomUUID()}`;
    const now = new Date().toISOString();
    this.s.insertTermBinding.run({
      id, term_id: input.termId, column_desc_id: input.columnDescId,
      confidence: input.confidence ?? 1.0, created_at: now,
    });
    return { id, termId: input.termId, columnDescId: input.columnDescId, confidence: input.confidence ?? 1.0, createdAt: now };
  }

  listTermBindingsByTerm(termId: string): TermBinding[] {
    return (this.s.listTermBindingsByTerm.all(termId) as TermBindingRow[]).map(this.rowToTermBinding);
  }

  listTermBindingsByColumn(columnDescId: string): TermBinding[] {
    return (this.s.listTermBindingsByCol.all(columnDescId) as TermBindingRow[]).map(this.rowToTermBinding);
  }

  deleteTermBinding(id: string): boolean {
    return this.s.deleteTermBinding.run(id).changes > 0;
  }

  // ── Data contracts ────────────────────────────────────────────────────────

  upsertDataContract(input: {
    catalogId: string; tableName: string;
    description?: string; expectations?: Record<string, ColumnExpectation>;
  }): DataContract {
    const id = `dc-${randomUUID()}`;
    const now = new Date().toISOString();
    this.s.insertDataContract.run({
      id, catalog_id: input.catalogId, table_name: input.tableName,
      version: "1", description: input.description ?? "",
      expectations: JSON.stringify(input.expectations ?? {}),
      created_at: now, updated_at: now,
    });
    const r = this.s.getDataContract.get(id) as DataContractRow | undefined;
    if (!r) throw new SemanticCatalogError("INTERNAL", "failed to upsert data contract");
    return this.rowToDataContract(r);
  }

  listDataContracts(catalogId: string): DataContract[] {
    return (this.s.listDataContracts.all(catalogId) as DataContractRow[]).map(this.rowToDataContract);
  }

  // ── Requirement bindings ─────────────────────────────────────────────────

  bindRequirement(input: {
    catalogId: string; requirementId: string; requirementLabel: string;
    datasourceId: string; tableName: string; columnName: string;
    bindingType?: RequirementBinding["bindingType"]; sqlSnippet?: string; confidence?: number;
  }): RequirementBinding {
    const id = `rb-${randomUUID()}`;
    const now = new Date().toISOString();
    this.s.upsertRequirementBinding.run({
      id, catalog_id: input.catalogId, requirement_id: input.requirementId,
      requirement_label: input.requirementLabel, datasource_id: input.datasourceId,
      table_name: input.tableName, column_name: input.columnName,
      binding_type: input.bindingType ?? "column",
      sql_snippet: input.sqlSnippet ?? "",
      confidence: input.confidence ?? 1.0, created_at: now,
    });
    return {
      id, catalogId: input.catalogId, requirementId: input.requirementId,
      requirementLabel: input.requirementLabel, datasourceId: input.datasourceId,
      tableName: input.tableName, columnName: input.columnName,
      bindingType: input.bindingType ?? "column",
      sqlSnippet: input.sqlSnippet ?? "", confidence: input.confidence ?? 1.0, createdAt: now,
    };
  }

  listRequirementBindingsByCatalog(catalogId: string): RequirementBinding[] {
    return (this.s.listRequirementBindingsByCatalog.all(catalogId) as RequirementBindingRow[]).map(this.rowToRequirementBinding);
  }

  listRequirementBindingsByRequirementId(requirementId: string): RequirementBinding[] {
    return (this.s.listRequirementBindingsByReq.all(requirementId) as RequirementBindingRow[]).map(this.rowToRequirementBinding);
  }

  /** Resolve a semantic context for a given datasource.
   *  Returns column descriptions + glossary terms for grounding.
   */
  resolveSemanticContext(workspaceId: string, datasourceId: string): {
    catalog: SemanticCatalog | null;
    columns: ColumnDescription[];
    glossary: GlossaryTerm[];
    bindings: TermBinding[];
    contracts: DataContract[];
  } {
    const catalogs = this.listCatalogs(workspaceId).filter(c => c.datasourceId === datasourceId);
    if (catalogs.length === 0) return { catalog: null, columns: [], glossary: [], bindings: [], contracts: [] };
    const catalog = catalogs[0]!;
    const columns = this.listColumnDescs(catalog.id);
    const glossary = this.listGlossaryTerms(catalog.id);
    const bindings = glossary.flatMap(t => this.listTermBindingsByTerm(t.id));
    const contracts = this.listDataContracts(catalog.id);
    return { catalog, columns, glossary, bindings, contracts };
  }
}
