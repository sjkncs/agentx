"use client";

import nextDynamic from "next/dynamic";

export const dynamic = "force-dynamic";

const NotebookHome = nextDynamic(
  () => import("./notebook-home").then((m) => m.NotebookHome),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-surface-subtle text-sm text-muted">
        Loading notebook…
      </div>
    ),
  },
);

export default function NotebookPage() {
  return <NotebookHome />;
}