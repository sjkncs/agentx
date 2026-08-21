"use client";

import nextDynamic from "next/dynamic";

const AdminHome = nextDynamic(() => import("../admin-home").then((m) => m.AdminHome), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-surface-subtle text-sm text-muted">
      Loading webhooks…
    </div>
  ),
});

export default function WebhooksPage() {
  return <AdminHome initialTab="webhooks" />;
}