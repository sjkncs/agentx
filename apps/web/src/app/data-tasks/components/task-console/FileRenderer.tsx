"use client";

import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";
import { detectRenderKind, parseCsv, type FileRenderKind } from "../../file-render";

/**
 * Unified built-in file renderer: markdown / csv / json / image / code / text.
 * Used by the file viewer so artifacts and work files are viewable in-app.
 */
export function FileRenderer({
  filename,
  mimeType,
  content,
  objectUrl,
}: {
  filename: string;
  mimeType?: string | null;
  /** Text content for markdown/csv/json/code/text. */
  content?: string | null;
  /** Object URL for images. */
  objectUrl?: string | null;
}) {
  const kind: FileRenderKind = detectRenderKind(filename, mimeType);

  if (kind === "image" && objectUrl) {
    return (
      <div className="grid place-items-center p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={objectUrl} alt={filename} className="max-h-[60vh] rounded-lg" />
      </div>
    );
  }

  const text = content ?? "";

  if (kind === "markdown") {
    return (
      <div className="prose prose-sm max-w-none p-3 text-sm leading-6">
        <CopilotChatAssistantMessage.MarkdownRenderer content={text} />
      </div>
    );
  }

  if (kind === "csv") {
    const rows = parseCsv(text, filename);
    const [head, ...body] = rows;
    return (
      <div className="max-h-[60vh] overflow-auto p-2">
        <table className="w-full border-collapse text-xs">
          {head ? (
            <thead>
              <tr>
                {head.map((c, i) => (
                  <th key={i} className="border border-border bg-surface-subtle px-2 py-1 text-left font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} className="border border-border px-2 py-1">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // json / code / text
  return (
    <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">
      {kind === "json" ? prettyJson(text) : text}
    </pre>
  );
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
