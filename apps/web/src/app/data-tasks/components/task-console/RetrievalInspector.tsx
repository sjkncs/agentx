"use client";

import { useState } from "react";
import { useT } from "../../../../i18n/locale-context";
import type { LiveRun } from "../../live-run-state";
import { extractRetrievalEntries, type RetrievalEntry } from "../../retrieval-inspector";
import { IconConnector } from "./console-icons-system";

/**
 * Expandable retrieval inspector: shows, per retrieval call (web_search /
 * retrieve_knowledge), the query and the retrieved items (title/snippet/link),
 * collapsible so the reasoning trail is inspectable without clutter.
 */
export function RetrievalInspector({ liveRun }: { liveRun: LiveRun }) {
  const t = useT();
  const entries = extractRetrievalEntries(liveRun.toolCalls);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  if (entries.length === 0) return null;

  const toggle = (i: number) => setOpen((o) => ({ ...o, [i]: !o[i] }));

  return (
    <section data-testid="retrieval-inspector" className="grid gap-2">
      <header className="flex items-center gap-2 text-muted">
        <IconConnector size={14} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em]">
          {t("inspector.title")}
        </h3>
        <span className="tabular rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-light">
          {entries.length}
        </span>
      </header>
      <ul className="grid gap-1.5">
        {entries.map((entry, i) => (
          <li key={i} className="rounded-lg border border-border bg-surface-subtle">
            <button
              type="button"
              onClick={() => toggle(i)}
              className="flex w-full cursor-pointer items-center gap-2 p-2 text-left"
            >
              <span
                className={[
                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                  entry.tool === "web_search"
                    ? "bg-primary-light/20 text-primary"
                    : "bg-step-success/15 text-step-success",
              ].join(" ")}
              >
                {entry.tool === "web_search" ? t("inspector.web") : t("inspector.kb")}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {entry.query || t("inspector.untitled")}
              </span>
              <span className="tabular shrink-0 text-[10px] text-muted-light">
                {entry.items.length}
              </span>
              <span aria-hidden="true" className="shrink-0 text-[10px] text-muted-light">
                {open[i] ? "▾" : "▸"}
              </span>
            </button>
            {open[i] ? (
              <ul className="grid gap-1 border-t border-border p-2">
                {entry.items.map((item, j) => (
                  <li key={j} className="grid gap-0.5">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-[11px] font-medium text-primary hover:underline"
                        title={item.url}
                      >
                        {item.title}
                      </a>
                    ) : (
                      <span className="truncate text-[11px] font-medium text-foreground">
                        {item.title}
                      </span>
                    )}
                    {item.snippet ? (
                      <p className="line-clamp-2 text-[11px] text-muted">{item.snippet}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Re-export for tests convenience.
export type { RetrievalEntry };
