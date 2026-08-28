import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DataFoundry",
    template: "%s · DataFoundry",
  },
  description:
    "DataFoundry turns the data stack you already have — datasources, notebooks, models, skills — into a workspace an agent can drive end-to-end.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
