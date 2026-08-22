import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workspace administration",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
