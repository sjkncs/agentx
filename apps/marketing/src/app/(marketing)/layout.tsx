/**
 * apps/marketing/src/app/(marketing)/layout.tsx
 *
 * Shared chrome for the public marketing site. Verbatim copy of
 * apps/web/src/app/(marketing)/layout.tsx — only the relative import
 * path to marketing.module.css differs.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import styles from "../marketing.module.css";

const NAV_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/skills", label: "Skill catalog" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
];

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.marketingRoot}>
      <header className={styles.nav}>
        <Link href="/" className={styles.brand} aria-label="DataFoundry home">
          <span className={styles.brandMark} aria-hidden />
          <span>DataFoundry</span>
        </Link>
        <nav className={styles.navLinks} aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={styles.navLink}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className={styles.navActions}>
          <Link
            href="https://github.com/sjkncs/agentx"
            className={styles.buttonSecondary}
          >
            GitHub
          </Link>
          <Link
            href="https://github.com/sjkncs/agentx#readme"
            className={styles.buttonPrimary}
          >
            Get started
          </Link>
        </div>
      </header>
      {children}
      <footer className={styles.footer}>
        <div>
          © {new Date().getFullYear()} DataFoundry · An agent-driven data task
          workspace.
        </div>
        <div className={styles.footerLinks}>
          <Link className={styles.footerLink} href="/features">
            Features
          </Link>
          <Link className={styles.footerLink} href="/skills">
            Skill catalog
          </Link>
          <Link className={styles.footerLink} href="/pricing">
            Pricing
          </Link>
          <Link className={styles.footerLink} href="/docs">
            Docs
          </Link>
        </div>
      </footer>
    </div>
  );
}
