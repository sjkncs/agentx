/**
 * Detect how to render a file based on its name / mime type.
 * Pure and testable; consumed by FileRenderer + FileViewerModal.
 */
export type FileRenderKind =
  | "markdown"
  | "csv"
  | "json"
  | "image"
  | "code"
  | "text";

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|sh|bash|sql|yml|yaml|toml|html|css|scss|java|go|rs|c|cc|cpp|h|hpp|cs|rb|php|kt|swift)$/i;

export function detectRenderKind(filename: string, mimeType?: string | null): FileRenderKind {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "text/markdown" || /\.md$/i.test(filename)) return "markdown";
  if (mime === "application/json" || /\.json$/i.test(filename)) return "json";
  if (mime === "text/csv" || /\.(csv|tsv)$/i.test(filename)) return "csv";
  if (CODE_EXT.test(filename)) return "code";
  return "text";
}

/** Parse CSV/TSV text into rows of cells (naive split, good enough for preview). */
export function parseCsv(text: string, filename: string): string[][] {
  const delim = /\.tsv$/i.test(filename) ? "\t" : ",";
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split(delim).map((c) => c.trim()))
    .slice(0, 200);
}
