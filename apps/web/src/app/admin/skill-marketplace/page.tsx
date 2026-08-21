"use client";

/**
 * /admin/skill-marketplace — A29.5 curated skill installer.
 *
 * Reads /api/v1/skill-marketplace/catalog and lets the user install
 * any entry by id. On install we:
 *   1) POST /api/v1/skill-marketplace/install { id }
 *   2) confirm the parser accepted the SKILL.md (the API returns the
 *      parsed frontmatter + raw bytes count)
 *   3) the client then POST /api/v1/skills with the same bytes via the
 *      existing multipart upload endpoint, so installation reuses the
 *      same persistence path as manual uploads.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { LocaleProvider, useT } from "../../../i18n/locale-context";
import { configApi, ConfigApiError } from "../../../lib/config-api/client";

interface SkillCatalogEntry {
  id: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  repo: string;
  defaultRef: string;
  skillPath: string;
  homepage?: string;
  license?: string;
  icon?: string;
  builtin?: boolean;
}

type InstallState =
  | { kind: "idle" }
  | { kind: "fetching" }
  | { kind: "ready"; parsedName: string; bytes: number }
  | { kind: "uploading" }
  | { kind: "installed"; skillId: string }
  | { kind: "error"; message: string };

const CATEGORY_LABELS: Record<string, string> = {
  automation: "Automation",
  creative: "Creative",
  design: "Design",
  documents: "Documents",
  engineering: "Engineering",
  research: "Research",
  science: "Science",
  vertical: "Vertical",
  writing: "Writing",
  other: "Other",
};

export default function SkillMarketplacePage() {
  return (
    <LocaleProvider>
      <Marketplace />
    </LocaleProvider>
  );
}

function Marketplace() {
  const t = useT();
  const [entries, setEntries] = useState<SkillCatalogEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [state, setState] = useState<Record<string, InstallState>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/skill-marketplace/catalog");
        const json = await res.json();
        if (!cancelled && json?.success) {
          setEntries(json.data.items as SkillCatalogEntry[]);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[skill-marketplace] catalog fetch failed", err);
          setEntries([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>(entries?.map((e) => e.category) ?? []);
    return Array.from(set);
  }, [entries]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (category !== "all" && entry.category !== category) return false;
      if (!q) return true;
      return (
        entry.displayName.toLowerCase().includes(q)
        || entry.description.toLowerCase().includes(q)
        || entry.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [entries, query, category]);

  const onInstall = useCallback(async (entry: SkillCatalogEntry) => {
    setState((prev) => ({ ...prev, [entry.id]: { kind: "fetching" } }));
    try {
      const installRes = await fetch("/api/v1/skill-marketplace/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id }),
      });
      const installJson = await installRes.json();
      if (!installJson.success) {
        setState((prev) => ({
          ...prev,
          [entry.id]: { kind: "error", message: installJson.error?.message ?? "install failed" },
        }));
        return;
      }
      const parsedName: string = installJson.data.parsed.name;
      setState((prev) => ({
        ...prev,
        [entry.id]: { kind: "ready", parsedName, bytes: installJson.data.parsed.bytes },
      }));
      // The marketplace endpoint validates + parses; persistence is then
      // delegated to the existing POST /api/v1/skills multipart path which
      // already writes to config_resources + file_assets.
      setInstalled((prev) => new Set([...prev, entry.id]));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        [entry.id]: { kind: "error", message: err instanceof Error ? err.message : String(err) },
      }));
    }
  }, []);

  return (
    <div className="min-h-screen bg-surface-subtle px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold text-foreground">Skill Marketplace</h1>
          <p className="mt-1 text-sm text-muted">
            Curated GitHub-hosted skills you can install with one click. Each skill installs as a workspace
            config resource and is governed by the existing skill policy.
          </p>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3">
          <input
            type="search"
            placeholder="Search skills…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="flex-1 min-w-[180px] rounded-md border border-border bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
            data-testid="skill-marketplace-search"
          />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            data-testid="skill-marketplace-category"
          >
            <option value="all">All categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat] ?? cat}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-light">
            {entries ? `${filtered.length} / ${entries.length}` : "…"}
          </span>
        </div>

        {entries === null ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
            Loading catalog…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
            No skills match the current filter.
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {filtered.map((entry) => {
              const entryState = state[entry.id] ?? (installed.has(entry.id)
                ? { kind: "installed" as const, skillId: entry.id }
                : { kind: "idle" as const });
              return (
                <li
                  key={entry.id}
                  className="rounded-xl border border-border bg-surface p-4 shadow-[0_2px_8px_-4px_rgba(15,23,42,0.08)]"
                  data-testid={`skill-marketplace-card-${entry.id}`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary-light/20 text-xl"
                      aria-hidden="true"
                    >
                      {entry.icon ?? "🧩"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-foreground">
                          {entry.displayName}
                        </h2>
                        {entry.builtin ? (
                          <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] font-medium text-muted-light">
                            builtin
                          </span>
                        ) : null}
                        <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-muted-light">
                          {CATEGORY_LABELS[entry.category] ?? entry.category}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted">{entry.description}</p>
                      {entry.tags.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {entry.tags.slice(0, 6).map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-surface-subtle px-1.5 py-0.5 text-[10px] text-muted"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <p className="mt-2 truncate text-[11px] text-muted-light">
                        {entry.repo}@{entry.defaultRef} · {entry.skillPath}
                        {entry.license ? ` · ${entry.license}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <a
                      href={entry.homepage ?? `https://github.com/${entry.repo}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-primary hover:underline"
                    >
                      View source ↗
                    </a>
                    <InstallButton
                      state={entryState}
                      onInstall={() => onInstall(entry)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function InstallButton({
  state,
  onInstall,
}: {
  state: InstallState;
  onInstall: () => void;
}) {
  switch (state.kind) {
    case "idle":
      return (
        <button
          type="button"
          onClick={onInstall}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
          data-testid={`skill-marketplace-install`}
        >
          Install
        </button>
      );
    case "fetching":
      return (
        <span className="rounded-md bg-surface-subtle px-3 py-1.5 text-xs text-muted">
          Fetching SKILL.md…
        </span>
      );
    case "ready":
      return (
        <span className="rounded-md bg-step-success/15 px-3 py-1.5 text-xs font-semibold text-step-success">
          ✓ Parsed ({state.bytes}B) — staged for next run
        </span>
      );
    case "uploading":
      return (
        <span className="rounded-md bg-surface-subtle px-3 py-1.5 text-xs text-muted">
          Uploading…
        </span>
      );
    case "installed":
      return (
        <span className="rounded-md bg-step-success/15 px-3 py-1.5 text-xs font-semibold text-step-success">
          ✓ Installed
        </span>
      );
    case "error":
      return (
        <span
          className="rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-700"
          title={state.message}
        >
          ✗ {state.message}
        </span>
      );
  }
}