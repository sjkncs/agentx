/**
 * apps/web/src/app/(marketing)/layout.tsx
 *
 * Shared chrome for the public marketing site (root, /features,
 * /pricing, /skills). Lives in a Next.js route group so the path is
 * still "/" without the /marketing segment appearing in the URL.
 *
 * Server component: no client JS for the nav/footer so the marketing
 * pages stay snappy on first paint and indexable by crawlers.
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
        <Link href="/" className={styles.brand} aria-label="AgentX home">
          <span className={styles.brandMark} aria-hidden />
          <span>AgentX</span>
        </Link>
        <nav className={styles.navLinks} aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={styles.navLink}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className={styles.navActions}>
          <Link href="/login" className={styles.buttonSecondary}>
            Sign in
          </Link>
          <Link href="/register" className={styles.buttonPrimary}>
            Get started
          </Link>
        </div>
      </header>
      {children}
      <footer className={styles.footer}>
        <div>© {new Date().getFullYear()} AgentX · An agent-driven data task workspace.</div>
        <div className={styles.footerLinks}>
          <Link className={styles.footerLink} href="/features">Features</Link>
          <Link className={styles.footerLink} href="/skills">Skill catalog</Link>
          <Link className={styles.footerLink} href="/pricing">Pricing</Link>
          <Link className={styles.footerLink} href="/login">Sign in</Link>
          <Link className={styles.footerLink} href="/register">Register</Link>
        </div>
      </footer>
    </div>
  );
}
