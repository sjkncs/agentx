"use client";

/**
 * /admin/skill-marketplace — A30 curated skill installer (full persistence).
 *
 * Reads /api/v1/skill-marketplace/catalog and lets the user install, sync,
 * and uninstall any entry by id. Install now persists into:
 *   - fileAssetService (source="skill-package")
 *   - metadataStore.configResources (kind="skill")
 *   - dfd_audit_events (category="skill-marketplace", action=install|sync|uninstall)
 *   - fsf_messages (intent="skill_marketplace")
 * so an admin can see exactly what shipped, when, from which GitHub revision.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { LocaleProvider, useT } from "../../../i18n/locale-context";

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

interface InstalledSkill {
  id: string;
  name: string;
  version: string;
  revision: number;
  status: string;
  defaultEnabled: boolean;
  builtin: boolean;
  packageFileRefId: string | null;
  updatedAt: string | null;
}

type InstallState =
  | { kind: "idle" }
  | { kind: "busy"; action: "install" | "sync" | "uninstall" }
  | { kind: "installed"; revision: number; bytes: number }
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
  other: "Other"
};

const CATEGORY_ICONS: Record<string, string> = {
  automation: "🌐",
  creative: "📜",
  design: "✉️",
  documents: "🎞️",
  engineering: "✨",
  research: "🌙",
  science: "🔬",
  vertical: "🍵",
  writing: "👄",
  other: "🧩"
};

interface MarketplaceAction {
  action: string;
  bytes: number;
  installedFrom: { repo: string; ref: string; skillPath: string; url: string };
  parsed: { name: string; version: string; tags: string[] };
  revision: number;
  fileAssetRefId: string;
  resourceId: string;
  supabase: { audit: { status: number; error: string | null }; fsf_message: { status: number; error: string | null } };
}

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
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [state, setState] = useState<Record<string, InstallState>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [catalogRes, installedRes] = await Promise.all([
        fetch("/api/v1/skill-marketplace/catalog"),
        fetch("/api/v1/skill-marketplace/installed")
      ]);
      const catalogJson = await catalogRes.json();
      const installedJson = await installedRes.json();
      if (catalogJson?.success) setEntries(catalogJson.data.items as SkillCatalogEntry[]);
      else setLoadError(catalogJson?.error?.message ?? "catalog fetch failed");
      if (installedJson?.success) setInstalled(installedJson.data.items as InstalledSkill[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
        || entry.repo.toLowerCase().includes(q)
      );
    });
  }, [entries, query, category]);

  const installedById = useMemo(() => {
    const map = new Map<string, InstalledSkill>();
    for (const item of installed) map.set(item.id, item);
    return map;
  }, [installed]);

  const runAction = useCallback(
    async (entry: SkillCatalogEntry, action: "install" | "sync" | "uninstall") => {
      setState((prev) => ({ ...prev, [entry.id]: { kind: "busy", action } }));
      try {
        const res = await fetch(`/api/v1/skill-marketplace/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: entry.id })
        });
        const json = await res.json();
        if (!json.success) {
          setState((prev) => ({
            ...prev,
            [entry.id]: { kind: "error", message: json.error?.message ?? `${action} failed` }
          }));
          return;
        }
        const data = json.data as MarketplaceAction & { uninstalled?: string };
        if (action === "uninstall") {
          setState((prev) => {
            const next = { ...prev };
            delete next[entry.id];
            return next;
          });
        } else {
          setState((prev) => ({
            ...prev,
            [entry.id]: {
              kind: "installed",
              revision: data.revision,
              bytes: data.bytes ?? data.parsed.tags.length
            }
          }));
        }
        await refresh();
      } catch (err) {
        setState((prev) => ({
          ...prev,
          [entry.id]: { kind: "error", message: err instanceof Error ? err.message : String(err) }
        }));
      }
    },
    [refresh]
  );

  return (
    <div className="min-h-screen bg-surface-subtle px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold text-foreground">Skill Marketplace</h1>
          <p className="mt-1 text-sm text-muted">
            Curated GitHub-hosted skills installed as workspace resources. Each install writes to
            {" "}<code>config_resources</code>, <code>file_assets</code> (source=<code>skill-package</code>),
            {" "}<code>dfd_audit_events</code>, and <code>fsf_messages</code> so you can audit any byte that landed.
          </p>
          {loadError ? (
            <p className="mt-2 rounded bg-rose-50 px-3 py-2 text-xs text-rose-700">{loadError}</p>
          ) : null}
        </header>

        <Summary installed={installed} />

        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3">
          <input
            type="search"
            placeholder="Search by name, tag, or repo…"
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
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs hover:bg-surface-subtle"
          >
            Refresh
          </button>
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
              const installedEntry = installedById.get(entry.id);
              const entryState: InstallState = state[entry.id] ?? (installedEntry
                ? { kind: "installed", revision: installedEntry.revision, bytes: 0 }
                : { kind: "idle" });
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
                      {entry.icon ?? CATEGORY_ICONS[entry.category] ?? "🧩"}
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
                        {installedEntry ? (
                          <span
                            className="rounded bg-step-success/15 px-1.5 py-0.5 text-[10px] font-medium text-step-success"
                            data-testid={`skill-marketplace-installed-${entry.id}`}
                          >
                            rev {installedEntry.revision}
                          </span>
                        ) : null}
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
                      <p className="mt-2 truncate text-[11px] text-muted-light" data-testid={`skill-marketplace-source-${entry.id}`}>
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
                    <SkillActions
                      state={entryState}
                      builtin={Boolean(entry.builtin)}
                      onInstall={() => runAction(entry, "install")}
                      onSync={() => runAction(entry, "sync")}
                      onUninstall={() => runAction(entry, "uninstall")}
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

function Summary({ installed }: { installed: InstalledSkill[] }) {
  const user = installed.filter((i) => !i.builtin).length;
  const builtin = installed.filter((i) => i.builtin).length;
  return (
    <div className="mb-3 grid grid-cols-3 gap-3" data-testid="skill-marketplace-summary">
      <Stat label="Installed" value={installed.length} />
      <Stat label="Workspace" value={user} />
      <Stat label="Built-in" value={builtin} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-light">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function SkillActions({
  state,
  builtin,
  onInstall,
  onSync,
  onUninstall
}: {
  state: InstallState;
  builtin: boolean;
  onInstall: () => void;
  onSync: () => void;
  onUninstall: () => void;
}) {
  if (state.kind === "busy") {
    return (
      <span className="rounded-md bg-surface-subtle px-3 py-1.5 text-xs text-muted">
        {state.action}…
      </span>
    );
  }
  if (state.kind === "error") {
    return (
      <span
        className="rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-700"
        title={state.message}
      >
        ✗ {state.message}
      </span>
    );
  }
  const installed = state.kind === "installed";
  return (
    <div className="flex items-center gap-2">
      {installed ? (
        <>
          <button
            type="button"
            onClick={onSync}
            className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-foreground hover:bg-surface-subtle"
            data-testid={`skill-marketplace-sync`}
          >
            Sync (rev {state.revision})
          </button>
          {!builtin ? (
            <button
              type="button"
              onClick={onUninstall}
              className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-100"
              data-testid={`skill-marketplace-uninstall`}
            >
              Uninstall
            </button>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          onClick={onInstall}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
          data-testid={`skill-marketplace-install`}
        >
          Install
        </button>
      )}
    </div>
  );
}
