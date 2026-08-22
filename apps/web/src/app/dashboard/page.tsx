"use client";

import nextDynamic from "next/dynamic";

export const dynamic = "force-dynamic";

const DashboardHome = nextDynamic(
  () => import("../notebook/dashboard-home").then((m) => m.DashboardHome),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-surface-subtle text-sm text-muted">
        Loading dashboard…
      </div>
    ),
  },
);

export default function DashboardPage() {
  return <DashboardHome />;
}