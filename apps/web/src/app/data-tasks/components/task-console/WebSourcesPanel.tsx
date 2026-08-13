"use client";

import { useT } from "../../../../i18n/locale-context";
import type { LiveRun } from "../../live-run-state";
import { IconConnector } from "./console-icons-system";

/**
 * External-source citation tracing panel: lists the web sources retrieved via
 * web_search with clickable links, so users can trace each cited source to its
 * origin (click-to-source).
 */
export function WebSourcesPanel({ liveRun }: { liveRun: LiveRun }) {
  const t = useT();
  const sources = liveRun.webSources ?? [];
  if (sources.length === 0) return null;

  return (
    <section data-testid="web-sources-panel" className="grid gap-2">
      <header className="flex items-center gap-2 text-muted">
        <IconConnector size={14} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em]">
          {t("webSources.title")}
        </h3>
        <span className="tabular rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted-light">
          {sources.length}
        </span>
      </header>
      <ul className="grid gap-1.5">
        {sources.map((source) => (
          <li
            key={`${source.index}-${source.url}`}
            className="rounded-lg border border-border bg-surface-subtle p-2"
          >
            <div className="flex items-start gap-2">
              <span className="tabular mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-primary-light/20 text-[10px] font-semibold text-primary">
                {source.index}
              </span>
              <div className="min-w-0 flex-1">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-xs font-medium text-primary hover:underline"
                  title={source.url}
                >
                  {source.title}
                </a>
                {source.snippet ? (
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{source.snippet}</p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
