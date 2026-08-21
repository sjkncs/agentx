"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LocaleProvider, useT } from "../../i18n/locale-context";
import { configApi, ConfigApiError } from "../../lib/config-api/client";
import type {
  AdminAuditEventDto,
  AdminAuditListResponseDto,
  AdminInvitationDto,
  AdminMemberDto,
  AdminMemberListResponseDto,
  AdminUserDto,
  WorkspaceRole,
} from "../../lib/config-api/types";
import { AdminMembersPanel } from "./admin-members-panel";
import { AdminAuditPanel } from "./admin-audit-panel";
import { AdminUsersPanel } from "./admin-users-panel";
import { AdminMetricsPanel } from "./admin-metrics-panel";
import { AdminAlertsPanel } from "./admin-alerts-panel";
import { AdminApprovalsPanel } from "./admin-approvals-panel";
import { AdminWebhooksPanel } from "./admin-webhooks-panel";
import { AdminWorkOrdersPanel } from "./admin-work-orders";
import { AdminDeliveryStatsPanel } from "./admin-delivery-stats";
import { AdminRetryConfigPanel } from "./admin-retry-config";

export type AdminTab = "members" | "audit" | "users" | "metrics" | "alerts" | "approvals" | "webhooks" | "workorders" | "delivery" | "retry";

export function AdminHome({ initialTab }: { initialTab: AdminTab }) {
  return (
    <LocaleProvider>
      <AdminShell initialTab={initialTab} />
    </LocaleProvider>
  );
}

const ROLE_PRIORITY: Record<WorkspaceRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

function roleCompare(a: WorkspaceRole, b: WorkspaceRole): number {
  return ROLE_PRIORITY[b] - ROLE_PRIORITY[a];
}

function AdminShell({ initialTab }: { initialTab: AdminTab }) {
  const router = useRouter();
  const t = useT();

  const [tab, setTab] = useState<AdminTab>(initialTab);
  const [ready, setReady] = useState(false);
  const [currentRole, setCurrentRole] = useState<WorkspaceRole | null>(null);
  const [members, setMembers] = useState<AdminMemberDto[]>([]);
  const [invitations, setInvitations] = useState<AdminInvitationDto[]>([]);
  const [users, setUsers] = useState<AdminUserDto[]>([]);
  const [audit, setAudit] = useState<AdminAuditListResponseDto | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const isAdmin = currentRole === "owner" || currentRole === "admin";

  const refreshMembers = useCallback(async () => {
    const res = await configApi.listAdminMembers();
    setMembers(res.items);
    setCurrentRole(res.current_role);
  }, []);

  const refreshInvitations = useCallback(async () => {
    const res = await configApi.listAdminInvitations();
    setInvitations(res.items);
  }, []);

  const refreshUsers = useCallback(async () => {
    const res = await configApi.listAdminUsers({ limit: 200 });
    setUsers(res.items);
  }, []);

  const refreshAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await configApi.listAdminAudit({ limit: 100 });
      setAudit(res);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  // initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await configApi.getMe();
        if (cancelled) return;
        const role = me.role ?? null;
        setCurrentRole(role);
        if (!role || (role !== "owner" && role !== "admin")) {
          setReady(true);
          return;
        }
        await Promise.all([refreshMembers(), refreshInvitations(), refreshUsers()]);
        if (cancelled) return;
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        setGlobalError(
          err instanceof ConfigApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load administration.",
        );
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshMembers, refreshInvitations, refreshUsers]);

  // refresh audit when tab changes
  useEffect(() => {
    if (!ready || !isAdmin) return;
    if (tab === "audit") {
      void refreshAudit();
    }
  }, [tab, ready, isAdmin, refreshAudit]);

  const sortedInvitations = useMemo(
    () =>
      [...invitations].sort((a, b) => {
        const aActive = !a.accepted_at && !a.revoked_at;
        const bActive = !b.accepted_at && !b.revoked_at;
        if (aActive !== bActive) return aActive ? -1 : 1;
        return b.created_at.localeCompare(a.created_at);
      }),
    [invitations],
  );

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => roleCompare(a.role, b.role) || a.created_at.localeCompare(b.created_at)),
    [members],
  );

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-subtle text-sm text-muted">
        Loading administration…
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-subtle">
        <section className="max-w-md rounded-xl border border-border bg-surface p-6 text-center shadow-[var(--shadow-card)]">
          <h1 className="text-base font-semibold text-foreground">{t("admin.forbidden.title")}</h1>
          <p className="mt-2 text-sm text-muted">{t("admin.forbidden.body")}</p>
          <button
            type="button"
            onClick={() => router.push("/data-tasks")}
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-light"
          >
            {t("admin.forbidden.cta")}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-surface-subtle text-foreground">
      <header className="flex h-16 items-center gap-4 border-b border-border bg-surface px-6">
        <button
          type="button"
          onClick={() => router.push("/data-tasks")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-light transition hover:bg-surface-subtle hover:text-foreground"
          aria-label={t("admin.back")}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold leading-snug text-foreground">
            {t("admin.title")}
          </h1>
          <p className="text-xs text-muted-light">{t("admin.subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full border border-border bg-surface-subtle px-2.5 py-0.5 text-[11px] font-medium text-muted">
            {t("admin.roleBadge", { role: currentRole ?? "—" })}
          </span>
        </div>
      </header>

      <nav
        role="tablist"
        aria-label={t("admin.tabs.label")}
        className="flex items-center gap-1 border-b border-border bg-surface px-6"
      >
        <AdminTabButton active={tab === "members"} onClick={() => setTab("members")} label={t("admin.tabs.members")} />
        <AdminTabButton active={tab === "audit"} onClick={() => setTab("audit")} label={t("admin.tabs.audit")} />
        <AdminTabButton active={tab === "users"} onClick={() => setTab("users")} label={t("admin.tabs.users")} />
        <AdminTabButton active={tab === "metrics"} onClick={() => setTab("metrics")} label={t("admin.tabs.metrics")} />
        <AdminTabButton active={tab === "alerts"} onClick={() => setTab("alerts")} label={t("admin.tabs.alerts")} />
        <AdminTabButton active={tab === "approvals"} onClick={() => setTab("approvals")} label={t("admin.tabs.approvals")} />
        <AdminTabButton active={tab === "webhooks"} onClick={() => setTab("webhooks")} label={t("admin.tabs.webhooks", { defaultValue: "Webhooks" })} />
        <AdminTabButton active={tab === "workorders"} onClick={() => setTab("workorders")} label={t("admin.tabs.workorders", { defaultValue: "工单" })} />
        <AdminTabButton active={tab === "delivery"} onClick={() => setTab("delivery")} label={t("admin.tabs.delivery", { defaultValue: "投递" })} />
        <AdminTabButton active={tab === "retry"} onClick={() => setTab("retry")} label={t("admin.tabs.retry", { defaultValue: "重试策略" })} />
      </nav>

      {globalError ? (
        <div className="border-b border-rose-200 bg-rose-50 px-6 py-2 text-xs text-rose-800">
          {globalError}
        </div>
      ) : null}

      <section className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        {tab === "members" ? (
          <AdminMembersPanel
            currentRole={currentRole as WorkspaceRole}
            members={sortedMembers}
            invitations={sortedInvitations}
            onRefreshMembers={refreshMembers}
            onRefreshInvitations={refreshInvitations}
          />
        ) : null}
        {tab === "audit" ? (
          <AdminAuditPanel data={audit} loading={auditLoading} onRefresh={refreshAudit} />
        ) : null}
        {tab === "users" ? (
          <AdminUsersPanel users={users} onRefresh={refreshUsers} currentRole={currentRole as WorkspaceRole} />
        ) : null}
        {tab === "metrics" ? <AdminMetricsPanel /> : null}
        {tab === "alerts" ? <AdminAlertsPanel /> : null}
        {tab === "approvals" ? <AdminApprovalsPanel /> : null}
        {tab === "webhooks" ? <AdminWebhooksPanel /> : null}
        {tab === "workorders" ? <AdminWorkOrdersPanel /> : null}
        {tab === "delivery" ? <AdminDeliveryStatsPanel /> : null}
        {tab === "retry" ? <AdminRetryConfigPanel /> : null}
      </section>
    </main>
  );
}

function AdminTabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "relative -mb-px flex h-12 items-center gap-1.5 border-b-2 px-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-light hover:text-foreground",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
