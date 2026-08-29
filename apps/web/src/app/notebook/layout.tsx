import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notebook · AgentX",
};

export default function NotebookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}