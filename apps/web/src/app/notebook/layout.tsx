import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notebook · DataFoundry",
};

export default function NotebookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}