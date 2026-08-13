import type { LiveWebSource } from "./live-run-state";

/**
 * Rewrites inline `[source:n]` citations in an assistant answer into markdown
 * links pointing at the traced web source URL, so citations are clickable and
 * resolve to the WebSourcesPanel entries (click-to-source).
 *
 * Pure and deterministic for unit testing. Unknown indices are left as-is.
 */
export function linkifyWebCitations(
  content: string,
  sources: LiveWebSource[] | undefined,
): string {
  if (!content) return content;
  if (!sources || sources.length === 0) return content;
  const byIndex = new Map<number, LiveWebSource>();
  for (const s of sources) byIndex.set(s.index, s);

  return content.replace(/\[\s*source\s*:\s*(\d+)\s*\]/gi, (match, digits: string) => {
    const index = Number(digits);
    const source = byIndex.get(index);
    if (!source) return match;
    return `[【${index}】](${source.url})`;
  });
}
