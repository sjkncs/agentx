"use client";

import { useState } from "react";
import { useT } from "../../i18n/locale-context";
import { configApi, ConfigApiError } from "../../lib/config-api/client";
import type { AdminUserDto, WorkspaceRole } from "../../lib/config-api/types";

export function AdminUsersPanel({
  users,
  currentRole,
  onRefresh,
}: {
  users: AdminUserDto[];
  currentRole: WorkspaceRole;
  onRefresh: () => Promise<void>;
}) {
  const t = useT();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const canDisable = currentRole === "owner";

  const filtered = users.filter((u) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      (u.email ?? "").toLowerCase().includes(q) ||
      (u.display_name ?? "").toLowerCase().includes(q) ||
      u.id.toLowerCase().includes(q)
    );
  });

  const handleToggleDisable = async (user: AdminUserDto) => {
    if (!canDisable && !user.disabled_at) {
      setError(t("admin.users.disableForbidden"));
      return;
    }
    setPending(user.id);
    setError(null);
    setInfo(null);
    try {
      const next = !user.disabled_at;
      await configApi.updateAdminUser(user.id, { disabled: next });
      setInfo(t(next ? "admin.users.disabledOk" : "admin.users.enabledOk", { email: user.email ?? "—" }));
      await onRefresh();
    } catch (err) {
      setError(
        err instanceof ConfigApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to update user.",
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</div>
      ) : null}
      {info ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{info}</div>
      ) : null}

      <article className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t("admin.users.title")}</h2>
            <p className="mt-1 text-xs text-muted">{t("admin.users.subtitle", { count: users.length })}</p>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("admin.users.searchPlaceholder")}
            className="h-9 w-64 rounded-lg border border-border bg-white px-3 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
          />
        </header>

        <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border">
          <table className="w-full min-w-max text-left text-[11px]">
            <thead className="sticky top-0 z-10 bg-surface-subtle text-muted-light shadow-[0_1px_0_0_var(--border)]">
              <tr>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.users.colEmail")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.users.colName")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.users.colVerified")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.users.colStatus")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.users.colJoined")}</th>
                <th className="px-2.5 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2.5 py-6 text-center text-xs text-muted-light">
                    {t("admin.users.empty")}
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id} className="border-t border-border transition-colors duration-150 hover:bg-primary-light/5">
                    <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-foreground">{u.email ?? "—"}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">{u.display_name ?? "—"}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">
                      {u.email_verified_at ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          {t("admin.users.verified")}
                        </span>
                      ) : (
                        <span className="text-muted-light">{t("admin.users.unverified")}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">
                      {u.disabled_at ? (
                        <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                          {t("admin.users.disabled")}
                        </span>
                      ) : (
                        <span className="text-muted-light">{t("admin.users.active")}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 tabular text-muted">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      <button
                        type="button"
                        disabled={pending === u.id}
                        onClick={() => handleToggleDisable(u)}
                        className="rounded-md border border-border bg-white px-2 py-0.5 text-[10px] font-medium text-muted transition hover:bg-surface-subtle hover:text-foreground disabled:opacity-50"
                      >
                        {u.disabled_at ? t("admin.users.enable") : t("admin.users.disable")}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
