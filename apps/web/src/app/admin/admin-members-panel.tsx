"use client";

import { useState } from "react";
import { useT } from "../../i18n/locale-context";
import { configApi, ConfigApiError } from "../../lib/config-api/client";
import type {
  AdminInvitationDto,
  AdminMemberDto,
  WorkspaceRole,
} from "../../lib/config-api/types";

const ROLE_OPTIONS: WorkspaceRole[] = ["admin", "member", "viewer"];

const ROLE_BADGE_CLASS: Record<WorkspaceRole, string> = {
  owner: "bg-primary text-white",
  admin: "bg-primary-light/15 text-primary",
  member: "bg-surface-subtle text-muted",
  viewer: "bg-surface-subtle text-muted-light",
};

export function AdminMembersPanel({
  currentRole,
  members,
  invitations,
  onRefreshMembers,
  onRefreshInvitations,
}: {
  currentRole: WorkspaceRole;
  members: AdminMemberDto[];
  invitations: AdminInvitationDto[];
  onRefreshMembers: () => Promise<void>;
  onRefreshInvitations: () => Promise<void>;
}) {
  const t = useT();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("viewer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [lastInviteLink, setLastInviteLink] = useState<{ token: string; email: string } | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<string | null>(null);

  const canInvite = currentRole === "owner" || currentRole === "admin";

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!inviteEmail.trim()) return;
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      const result = await configApi.createAdminInvitation(inviteEmail.trim(), inviteRole);
      setLastInviteLink({ token: result.token, email: inviteEmail.trim() });
      setInfo(t("admin.members.inviteSuccess", { email: inviteEmail.trim() }));
      setInviteEmail("");
      await onRefreshInvitations();
    } catch (err) {
      setError(
        err instanceof ConfigApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to invite member.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (member: AdminMemberDto, role: WorkspaceRole) => {
    if (member.role === role) return;
    setPendingRoleChange(member.user_id);
    setError(null);
    setInfo(null);
    try {
      await configApi.changeAdminMemberRole(member.user_id, role);
      setInfo(t("admin.members.roleChanged", { email: member.email ?? "—" }));
      await onRefreshMembers();
    } catch (err) {
      setError(
        err instanceof ConfigApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to change role.",
      );
    } finally {
      setPendingRoleChange(null);
    }
  };

  const handleRemove = async (member: AdminMemberDto) => {
    if (member.is_self) return;
    if (!window.confirm(t("admin.members.confirmRemove", { email: member.email ?? "" }))) return;
    setError(null);
    try {
      await configApi.removeAdminMember(member.user_id);
      setInfo(t("admin.members.removed", { email: member.email ?? "—" }));
      await onRefreshMembers();
    } catch (err) {
      setError(
        err instanceof ConfigApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to remove member.",
      );
    }
  };

  const handleRevokeInvite = async (inv: AdminInvitationDto) => {
    setError(null);
    try {
      await configApi.revokeAdminInvitation(inv.id);
      setInfo(t("admin.members.inviteRevoked", { email: inv.email }));
      await onRefreshInvitations();
    } catch (err) {
      setError(
        err instanceof ConfigApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to revoke invitation.",
      );
    }
  };

  const copyInviteLink = async () => {
    if (!lastInviteLink) return;
    const link = `${window.location.origin}/invite?token=${lastInviteLink.token}`;
    try {
      await navigator.clipboard.writeText(link);
      setInfo(t("admin.members.inviteCopied"));
    } catch {
      setError(t("admin.members.inviteCopyFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {error}
        </div>
      ) : null}
      {info ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {info}
        </div>
      ) : null}

      {canInvite ? (
        <article className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <header className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">{t("admin.members.inviteTitle")}</h2>
            <p className="mt-1 text-xs text-muted">{t("admin.members.inviteHint")}</p>
          </header>
          <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col">
              <span className="mb-1 text-xs font-medium text-muted">{t("admin.members.emailLabel")}</span>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@example.com"
                required
                className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </label>
            <label className="flex flex-col">
              <span className="mb-1 text-xs font-medium text-muted">{t("admin.members.roleLabel")}</span>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                className="h-9 rounded-lg border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`admin.roles.${r}`)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={submitting || !inviteEmail.trim()}
              className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? t("admin.members.sending") : t("admin.members.sendInvite")}
            </button>
          </form>
          {lastInviteLink ? (
            <div className="mt-3 rounded-lg border border-dashed border-border bg-surface-subtle px-3 py-2 text-xs text-muted">
              <div className="mb-1 font-medium text-foreground">{t("admin.members.shareLink")}</div>
              <code className="block break-all font-mono text-[11px] text-primary">
                {`${typeof window !== "undefined" ? window.location.origin : ""}/invite?token=${lastInviteLink.token}`}
              </code>
              <button
                type="button"
                onClick={copyInviteLink}
                className="mt-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
              >
                {t("admin.members.copyLink")}
              </button>
            </div>
          ) : null}
        </article>
      ) : null}

      <article className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t("admin.members.listTitle")}</h2>
            <p className="mt-1 text-xs text-muted">{t("admin.members.listHint", { count: members.length })}</p>
          </div>
        </header>
        <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border">
          <table className="w-full min-w-max text-left text-[11px]">
            <thead className="sticky top-0 z-10 bg-surface-subtle text-muted-light shadow-[0_1px_0_0_var(--border)]">
              <tr>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.members.colEmail")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.members.colName")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.members.colRole")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.members.colStatus")}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5 font-semibold">{t("admin.members.colJoined")}</th>
                <th className="px-2.5 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id} className="border-t border-border transition-colors duration-150 hover:bg-primary-light/5">
                  <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-foreground">
                    {m.email ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">{m.display_name ?? "—"}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROLE_BADGE_CLASS[m.role]}`}>
                      {t(`admin.roles.${m.role}`)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-muted">
                    {m.disabled ? (
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                        {t("admin.members.disabled")}
                      </span>
                    ) : (
                      <span className="text-muted-light">{t("admin.members.active")}</span>
                    )}
                    {m.is_self ? (
                      <span className="ml-1.5 rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[10px] font-medium text-muted">
                        {t("admin.members.you")}
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 tabular text-muted">
                    {new Date(m.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    {!m.is_self && (currentRole === "owner" || currentRole === "admin") ? (
                      <div className="flex items-center justify-end gap-2">
                        <select
                          value={m.role}
                          disabled={pendingRoleChange === m.user_id}
                          onChange={(e) => handleRoleChange(m, e.target.value as WorkspaceRole)}
                          className="h-8 rounded-md border border-border bg-white px-2 text-[11px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
                        >
                          {currentRole === "owner" ? (
                            <option value="owner">{t("admin.roles.owner")}</option>
                          ) : null}
                          <option value="admin">{t("admin.roles.admin")}</option>
                          <option value="member">{t("admin.roles.member")}</option>
                          <option value="viewer">{t("admin.roles.viewer")}</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => handleRemove(m)}
                          className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-100"
                        >
                          {t("admin.members.remove")}
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {invitations.length > 0 ? (
        <article className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
          <header className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">{t("admin.members.invitationsTitle")}</h2>
            <p className="mt-1 text-xs text-muted">{t("admin.members.invitationsHint", { count: invitations.length })}</p>
          </header>
          <ul className="flex flex-col gap-2">
            {invitations.map((inv) => {
              const status = inv.accepted_at
                ? "accepted"
                : inv.revoked_at
                  ? "revoked"
                  : new Date(inv.expires_at).getTime() < Date.now()
                    ? "expired"
                    : "pending";
              return (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-subtle px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{inv.email}</div>
                    <div className="text-[11px] text-muted-light">
                      {t(`admin.members.invitedAt`)} {new Date(inv.created_at).toLocaleString()} · {t(`admin.members.expiresAt`)} {new Date(inv.expires_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${invitationStatusClasses(status)}`}>
                      {t(`admin.invitations.status.${status}`)}
                    </span>
                    <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-medium text-muted">
                      {t(`admin.roles.${inv.role}`)}
                    </span>
                    {status === "pending" && (currentRole === "owner" || currentRole === "admin") ? (
                      <button
                        type="button"
                        onClick={() => handleRevokeInvite(inv)}
                        className="rounded-md border border-border bg-white px-2 py-0.5 text-[10px] font-medium text-muted transition hover:bg-surface-subtle hover:text-foreground"
                      >
                        {t("admin.members.revoke")}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </article>
      ) : null}
    </div>
  );
}

function invitationStatusClasses(status: "pending" | "accepted" | "revoked" | "expired"): string {
  switch (status) {
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "accepted":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "revoked":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "expired":
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}
