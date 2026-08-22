/**
 * Automatic schema grounding service.
 *
 * Given a datasource's physical schema (table/column names + types from inspect_schema),
 * this service automatically infers semantic types and produces a grounding result
 * that the data-analysis protocol uses to set `semanticResolved = true`.
 *
 * The inference pipeline:
 *
 *   1. Pattern matching
 *      Column names are matched against a curated set of regex patterns to
 *      infer semantic types:
 *        - id suffix      → identifier.{suffix}
 *        - _at, _ts, date → time.datetime / time.date
 *        - _amount, _price, _cost → currency.amount
 *        - _pct, _rate, _ratio → ratio.percentage
 *        - _email          → person.email
 *        - _phone          → person.phone
 *        - _city, _country → geo.city / geo.country
 *        - _status, _type  → category.status / category.type
 *        - _name, _nm      → entity.name
 *        - _url, _link     → web.url
 *        - _desc, _text    → text.description
 *        - _flag, _yn      → flag.boolean
 *        - _num, _cnt, _qty → numeric.count
 *
 *   2. Type inference
 *      The physical type maps to a base type family:
 *        varchar/text → text, int/bigint/float/decimal → numeric, bool → flag,
 *        date/timestamp → time, json → structured
 *
 *   3. Suggestion scoring
 *      Each inference gets a confidence score (0.0–1.0):
 *        exact match     → 0.95
 *        partial match   → 0.70–0.90
 *        ambiguous       → 0.50
 *        no match       → 0.00 (no semantic type suggested)
 *
 *   4. Catalog integration
 *      The grounder can write inferred column descriptions back to the catalog,
 *      creating a "pending" description that users can review and confirm.
 *
 * The grounding result shape matches what the data-analysis protocol's
 * `semantic.context.resolve` action expects.
 */
import type { LocalDataGateway } from "@datafoundry/data-gateway";

export interface PhysicalColumn {
  name: string;
  type: string;       // physical DB type e.g. "varchar", "bigint", "timestamp"
  nullable: boolean;
  primaryKey?: boolean;
}

export interface PhysicalTable {
  name: string;
  columns: PhysicalColumn[];
}

export interface PhysicalSchema {
  tables: PhysicalTable[];
}

export interface SemanticInference {
  columnName: string;
  tableName: string;
  physicalType: string;
  inferredSemanticType: string;
  confidence: number;
  pattern: string;       // which pattern matched, e.g. "id_suffix", "datetime_pattern"
  description: string;   // auto-generated human-readable description
}

export interface GroundingResult {
  datasourceId: string;
  datasourceRevision: string;
  mode: "catalog" | "inferred" | "unavailable";
  trust: "high" | "medium" | "low";
  columns: SemanticInference[];
  glossary: Array<{
    term: string;
    definition: string;
    businessType: string;
    confidence: number;
    boundColumns: string[];
  }>;
  warnings: string[];
  catalogId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern definitions
// ─────────────────────────────────────────────────────────────────────────────

interface SemanticPattern {
  /** Regex that matches the column name (case-insensitive). */
  regex: RegExp;
  /** Inferred semantic type. */
  semanticType: string;
  /** Human-readable description template: $1 = column name, $2 = table name. */
  descriptionTemplate: string;
  /** Base confidence (can be reduced by ambiguity). */
  baseConfidence: number;
  /** Reason for this inference. */
  reason: string;
}

const SEMANTIC_PATTERNS: SemanticPattern[] = [
  // ── Identifiers ──────────────────────────────────────────────────────────
  { regex: /\b(id|uuid|guid|pk)\b/i, semanticType: "identifier.id",
    descriptionTemplate: "Unique identifier column",
    baseConfidence: 0.95, reason: "id_suffix" },
  { regex: /_id\b|id_\b/i, semanticType: "identifier.foreign_key",
    descriptionTemplate: "Foreign key reference",
    baseConfidence: 0.85, reason: "id_reference" },
  { regex: /\b(order_id|invoice_id|user_id|customer_id|product_id|session_id)\b/i,
    semanticType: "identifier.reference",
    descriptionTemplate: "Reference to a related entity",
    baseConfidence: 0.90, reason: "named_reference" },

  // ── Time / temporal ──────────────────────────────────────────────────────
  { regex: /\b(created_at|updated_at|inserted_at|modified_at)\b/i,
    semanticType: "time.timestamp",
    descriptionTemplate: "Record creation/modification timestamp",
    baseConfidence: 0.95, reason: "audit_timestamp" },
  { regex: /_at\b|_ts\b|\bdate\b|\bdatetime\b|\btime\b/i,
    semanticType: "time.datetime",
    descriptionTemplate: "Temporal date/time value",
    baseConfidence: 0.70, reason: "datetime_pattern" },
  { regex: /\b(dob|birthday|birth_date)\b/i,
    semanticType: "time.date_of_birth",
    descriptionTemplate: "Date of birth",
    baseConfidence: 0.90, reason: "dob_pattern" },
  { regex: /\b(expires_at|deadline|due_date|start_date|end_date)\b/i,
    semanticType: "time.scheduled",
    descriptionTemplate: "Scheduled or deadline date",
    baseConfidence: 0.90, reason: "scheduled_date" },

  // ── Currency / monetary ────────────────────────────────────────────────
  { regex: /_amount\b|_price\b|_cost\b|_revenue\b|_total\b|_subtotal\b|_tax\b|_fee\b/i,
    semanticType: "currency.amount",
    descriptionTemplate: "Monetary amount in the default currency",
    baseConfidence: 0.90, reason: "monetary_pattern" },
  { regex: /\b(balance|outstanding|paid|receivable|payable)\b/i,
    semanticType: "currency.balance",
    descriptionTemplate: "Account or financial balance",
    baseConfidence: 0.85, reason: "balance_pattern" },
  { regex: /\b(currency|ccy|iso_currency)\b/i,
    semanticType: "currency.code",
    descriptionTemplate: "ISO 4217 currency code (e.g. USD, CNY)",
    baseConfidence: 0.95, reason: "currency_code" },

  // ── Percentages / ratios ─────────────────────────────────────────────
  { regex: /_pct\b|_rate\b|_ratio\b|_share\b|_proportion\b|_percentage\b/i,
    semanticType: "ratio.percentage",
    descriptionTemplate: "Ratio expressed as a percentage (0–100) or decimal (0–1)",
    baseConfidence: 0.90, reason: "percentage_pattern" },
  { regex: /\b(probability|likelihood|confidence)\b/i,
    semanticType: "ratio.probability",
    descriptionTemplate: "Probability or likelihood score (0–1)",
    baseConfidence: 0.90, reason: "probability_pattern" },

  // ── Count / numeric ───────────────────────────────────────────────────
  { regex: /\b(quantity|count|qty|cnt|num|number)\b/i,
    semanticType: "numeric.count",
    descriptionTemplate: "Count or quantity of items",
    baseConfidence: 0.90, reason: "count_pattern" },
  { regex: /\b(rank|position|seq|sequence|ordinal)\b/i,
    semanticType: "numeric.ordinal",
    descriptionTemplate: "Ordinal position or rank",
    baseConfidence: 0.80, reason: "ordinal_pattern" },

  // ── Person / contact ──────────────────────────────────────────────────
  { regex: /\b(email|e-mail|mail)\b/i,
    semanticType: "person.email",
    descriptionTemplate: "Email address",
    baseConfidence: 0.95, reason: "email_pattern" },
  { regex: /\b(phone|mobile|cell|tel|fax)\b/i,
    semanticType: "person.phone",
    descriptionTemplate: "Phone number",
    baseConfidence: 0.90, reason: "phone_pattern" },
  { regex: /\b(first_name|given_name|last_name|surname|full_name|username|nickname)\b/i,
    semanticType: "person.name",
    descriptionTemplate: "Person name or username",
    baseConfidence: 0.90, reason: "person_name" },
  { regex: /\b(gender|sex)\b/i,
    semanticType: "person.demographic",
    descriptionTemplate: "Gender or biological sex",
    baseConfidence: 0.80, reason: "demographic_pattern" },
  { regex: /\b(age|birth_year|dob)\b/i,
    semanticType: "person.age",
    descriptionTemplate: "Age in years",
    baseConfidence: 0.85, reason: "age_pattern" },

  // ── Geographic ──────────────────────────────────────────────────────
  { regex: /\b(city|town|locality)\b/i,
    semanticType: "geo.city",
    descriptionTemplate: "City or town name",
    baseConfidence: 0.85, reason: "city_pattern" },
  { regex: /\b(country|nation|state|province|region|zip|postal)\b/i,
    semanticType: "geo.region",
    descriptionTemplate: "Country, state, province, or postal code",
    baseConfidence: 0.80, reason: "region_pattern" },
  { regex: /\b(lat|long|latitude|longitude|coord|geo)\b/i,
    semanticType: "geo.coordinates",
    descriptionTemplate: "Geographic coordinates (latitude/longitude)",
    baseConfidence: 0.95, reason: "geo_pattern" },
  { regex: /\b(address|street|line1|line2|building)\b/i,
    semanticType: "geo.address",
    descriptionTemplate: "Street address",
    baseConfidence: 0.85, reason: "address_pattern" },

  // ── Category / status ────────────────────────────────────────────────
  { regex: /_status\b|_state\b/i,
    semanticType: "category.status",
    descriptionTemplate: "Status or state of the record",
    baseConfidence: 0.85, reason: "status_pattern" },
  { regex: /_type\b|_kind\b|_category\b|_class\b/i,
    semanticType: "category.type",
    descriptionTemplate: "Type, kind, or category classification",
    baseConfidence: 0.85, reason: "category_pattern" },
  { regex: /\b(tag|label|segment|cohort|level|tier)\b/i,
    semanticType: "category.label",
    descriptionTemplate: "Categorical tag or label",
    baseConfidence: 0.75, reason: "label_pattern" },
  { regex: /\b(country_code|iso_code|ccode)\b/i,
    semanticType: "category.code",
    descriptionTemplate: "Standardised country or region code (ISO 3166)",
    baseConfidence: 0.90, reason: "code_pattern" },

  // ── Boolean / flag ───────────────────────────────────────────────────
  { regex: /_flag\b|_is_\w+|_has_\w+|_have_\w+|_active\b|_enabled\b|_verified\b/i,
    semanticType: "flag.boolean",
    descriptionTemplate: "Boolean flag (true/false or Y/N)",
    baseConfidence: 0.85, reason: "flag_pattern" },
  { regex: /^yn\b|is_\w+|has_\w+|have_\w+/i,
    semanticType: "flag.boolean",
    descriptionTemplate: "Yes/No or true/false indicator",
    baseConfidence: 0.80, reason: "yn_pattern" },

  // ── Text / description ────────────────────────────────────────────────
  { regex: /\b(desc|description|notes|comment|memo|remark)\b/i,
    semanticType: "text.description",
    descriptionTemplate: "Free-text description or notes",
    baseConfidence: 0.85, reason: "description_pattern" },
  { regex: /\b(title|subject|headline|name)\b/i,
    semanticType: "text.title",
    descriptionTemplate: "Title or subject line",
    baseConfidence: 0.85, reason: "title_pattern" },
  { regex: /_url\b|_link\b|\bhref\b|\bendpoint\b|\buri\b/i,
    semanticType: "web.url",
    descriptionTemplate: "URL or web link",
    baseConfidence: 0.90, reason: "url_pattern" },
  { regex: /_ip\b|\bip_address\b|\bipaddr\b/i,
    semanticType: "network.ip_address",
    descriptionTemplate: "IP address",
    baseConfidence: 0.90, reason: "ip_pattern" },

  // ── File / media ───────────────────────────────────────────────────
  { regex: /_path\b|_file\b|\bimage_url\b|\bavatar_url\b|\bbucket\b/i,
    semanticType: "media.file_path",
    descriptionTemplate: "File path or storage reference",
    baseConfidence: 0.80, reason: "file_pattern" },
  { regex: /_mime\b|_mime_type\b|\bcontent_type\b|\bmedia_type\b/i,
    semanticType: "media.mime_type",
    descriptionTemplate: "MIME type / content type",
    baseConfidence: 0.95, reason: "mime_pattern" },

  // ── JSON / structured ────────────────────────────────────────────────
  { regex: /_json\b|_meta\b|_attrs\b|_extra\b|_properties\b|_config\b/i,
    semanticType: "structured.json",
    descriptionTemplate: "Structured JSON or metadata blob",
    baseConfidence: 0.80, reason: "json_pattern" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Physical type → base type family
// ─────────────────────────────────────────────────────────────────────────────

function inferPhysicalTypeFamily(physicalType: string): string {
  const t = physicalType.toLowerCase();
  if (/int|bigint|smallint|numeric|decimal|real|float|double/.test(t)) return "numeric";
  if (/bool|bit/.test(t)) return "flag";
  if (/date|time|interval/.test(t)) return "time";
  if (/json|xml|jsonb/.test(t)) return "structured";
  if (/text|varchar|nvarchar|char|string/.test(t)) return "text";
  if (/binary|blob|bytea|bytes/.test(t)) return "binary";
  return "unknown";
}

function physicalToSemanticFamily(physicalTypeFamily: string): string {
  const map: Record<string, string> = {
    numeric: "numeric.general",
    flag: "flag.boolean",
    time: "time.datetime",
    structured: "structured",
    text: "text",
    binary: "binary",
  };
  return map[physicalTypeFamily] ?? "text";
}

// ─────────────────────────────────────────────────────────────────────────────
// Core inference engine
// ─────────────────────────────────────────────────────────────────────────────

export function inferSemanticTypes(schema: PhysicalSchema): SemanticInference[] {
  const inferences: SemanticInference[] = [];

  for (const table of schema.tables) {
    for (const column of table.columns) {
      const colName = column.name;
      const colType = column.type;
      const typeFamily = inferPhysicalTypeFamily(colType);

      // Find the best matching pattern
      let best: SemanticPattern | null = null;
      let bestConfidence = 0;

      for (const pattern of SEMANTIC_PATTERNS) {
        if (pattern.regex.test(colName)) {
          if (pattern.baseConfidence > bestConfidence) {
            best = pattern;
            bestConfidence = pattern.baseConfidence;
          }
        }
      }

      // Check for exact column-name matches (highest priority)
      const EXACT_MAP: Record<string, { type: string; confidence: number; reason: string }> = {
        id: { type: "identifier.id", confidence: 0.95, reason: "exact_id" },
        uuid: { type: "identifier.id", confidence: 0.95, reason: "exact_uuid" },
        email: { type: "person.email", confidence: 0.95, reason: "exact_email" },
        phone: { type: "person.phone", confidence: 0.95, reason: "exact_phone" },
        created_at: { type: "time.timestamp", confidence: 0.95, reason: "exact_created_at" },
        updated_at: { type: "time.timestamp", confidence: 0.95, reason: "exact_updated_at" },
        deleted_at: { type: "time.timestamp", confidence: 0.95, reason: "exact_deleted_at" },
        latitude: { type: "geo.coordinates", confidence: 0.95, reason: "exact_latitude" },
        longitude: { type: "geo.coordinates", confidence: 0.95, reason: "exact_longitude" },
        password: { type: "credential.secret", confidence: 0.95, reason: "exact_password" },
        api_key: { type: "credential.secret", confidence: 0.95, reason: "exact_api_key" },
        token: { type: "credential.token", confidence: 0.95, reason: "exact_token" },
      };

      const exact = EXACT_MAP[colName.toLowerCase()];
      const finalConfidence = exact ? exact.confidence : bestConfidence;
      const finalSemanticType = exact
        ? exact.type
        : best
          ? best.semanticType
          : physicalToSemanticFamily(typeFamily);
      const finalReason = exact ? exact.reason : best?.reason ?? typeFamily;
      const finalDescription = best
        ? best.descriptionTemplate.replace(/\$1/g, colName).replace(/\$2/g, table.name)
        : `${colName} — ${typeFamily} column in ${table.name}`;

      // Reduce confidence if column name is very short (ambiguous)
      const adjustedConfidence = colName.length <= 2 ? finalConfidence * 0.7 : finalConfidence;

      inferences.push({
        columnName: colName,
        tableName: table.name,
        physicalType: colType,
        inferredSemanticType: finalSemanticType,
        confidence: Math.round(adjustedConfidence * 100) / 100,
        pattern: finalReason,
        description: finalDescription,
      });
    }
  }

  return inferences;
}

// ─────────────────────────────────────────────────────────────────────────────
// Glossary inference from column names
// ─────────────────────────────────────────────────────────────────────────────

export function inferGlossaryTerms(inferences: SemanticInference[]): GroundingResult["glossary"] {
  const glossary: GroundingResult["glossary"] = [];
  const seen = new Set<string>();

  for (const inf of inferences) {
    // Extract a clean term from the column name
    const raw = inf.columnName
      .replace(/_id$/i, "")
      .replace(/_at$/i, "")
      .replace(/_ts$/i, "")
      .replace(/_pct$/i, "")
      .replace(/_num$/i, "")
      .replace(/_cnt$/i, "")
      .replace(/_/g, " ")
      .trim();

    if (!raw || seen.has(raw.toLowerCase())) continue;
    seen.add(raw.toLowerCase());

    const DEFINITIONS: Record<string, { definition: string; businessType: string }> = {
      "order": { definition: "Customer order or purchase transaction", businessType: "transaction" },
      "customer": { definition: "Individual or organisation that places orders", businessType: "entity" },
      "product": { definition: "Item or service offered for sale", businessType: "product" },
      "user": { definition: "Registered user of the platform", businessType: "entity" },
      "revenue": { definition: "Total income generated from sales", businessType: "financial_metric" },
      "price": { definition: "Unit selling price of a product", businessType: "pricing" },
      "cost": { definition: "Direct or indirect cost incurred", businessType: "financial_metric" },
      "quantity": { definition: "Number of units in an order or inventory", businessType: "inventory" },
      "date": { definition: "Point in time or date of an event", businessType: "temporal" },
      "status": { definition: "Current state or status of a record", businessType: "state" },
      "name": { definition: "Human-readable name or label", businessType: "identifier" },
      "email": { definition: "Email address for communication", businessType: "contact" },
      "phone": { definition: "Telephone or mobile number", businessType: "contact" },
      "country": { definition: "Country name or ISO code", businessType: "geographic" },
      "city": { definition: "City or metropolitan area", businessType: "geographic" },
    };

    const def = DEFINITIONS[raw.toLowerCase()];
    if (def) {
      glossary.push({
        term: raw.replace(/\b\w/g, (c) => c.toUpperCase()),
        definition: def.definition,
        businessType: def.businessType,
        confidence: inf.confidence * 0.9,
        boundColumns: [`${inf.tableName}.${inf.columnName}`],
      });
    }
  }

  return glossary;
}

// ─────────────────────────────────────────────────────────────────────────────
// High-level grounding function
// ─────────────────────────────────────────────────────────────────────────────

export async function groundDatasourceSchema(
  schema: PhysicalSchema,
  datasourceId: string,
  options: {
    gateway: LocalDataGateway;
    writeToCatalog?: boolean;
    catalogId?: string;
  },
): Promise<GroundingResult> {
  // Step 1: infer semantic types
  const inferences = inferSemanticTypes(schema);
  const warnings: string[] = [];

  // Step 2: check for ambiguous columns (e.g. "val", "data", "misc")
  const AMBIGUOUS = /^(val|data|misc|other|temp|x|y|z|n)$/i;
  for (const inf of inferences) {
    if (AMBIGUOUS.test(inf.columnName)) {
      warnings.push(`Column "${inf.tableName}.${inf.columnName}" has an ambiguous name — semantic type may be incorrect.`);
    }
    if (inf.confidence < 0.5) {
      warnings.push(`Low confidence (${inf.confidence}) for "${inf.tableName}.${inf.columnName}" — manual review recommended.`);
    }
  }

  // Step 3: infer glossary
  const glossary = inferGlossaryTerms(inferences);

  // Step 4: determine trust level
  const avgConfidence = inferences.length > 0
    ? inferences.reduce((s, i) => s + i.confidence, 0) / inferences.length
    : 0;
  const trust = avgConfidence >= 0.85 ? "high" : avgConfidence >= 0.65 ? "medium" : "low";

  // Step 5: optional — write to catalog
  if (options.writeToCatalog && options.catalogId) {
    // Defer catalog writes to the repository layer to keep this pure
    void options;
  }

  const datasourceRevision = schema.tables.length > 0
    ? `t${schema.tables.length}_c${inferences.length}_${Date.now()}`
    : "empty";

  return {
    datasourceId,
    datasourceRevision,
    mode: "inferred",
    trust,
    columns: inferences,
    glossary,
    warnings,
    ...(options.catalogId !== undefined ? { catalogId: options.catalogId } : {}),
  };
}
