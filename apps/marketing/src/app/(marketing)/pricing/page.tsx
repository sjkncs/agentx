/**
 * apps/marketing/src/app/(marketing)/pricing/page.tsx
 *
 * Three-tier pricing + feature-comparison matrix. Static, no API.
 * Verbatim copy of apps/web/src/app/(marketing)/pricing/page.tsx with
 * the marketing.module.css import path adjusted.
 */
import Link from "next/link";

import styles from "../../marketing.module.css";

type Tier = {
  id: string;
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  highlighted?: boolean;
  features: ReadonlyArray<string>;
  ctaLabel: string;
  ctaHref: string;
};

const TIERS: ReadonlyArray<Tier> = [
  {
    id: "community",
    name: "Community",
    price: "Free",
    cadence: "self-hosted",
    tagline: "For solo developers, hobby projects, and pilot deployments.",
    features: [
      "Unlimited single-machine installs",
      "All 13 bundled skills (TDD, MCP, Slide Kit, …)",
      "Bring-your-own LLM (Anthropic / OpenAI / Qwen / DeepSeek / Ollama)",
      "Local SQLite storage for datasources + knowledge bases",
      "Companion-mode desktop pet with persona guardrails",
      "Community support via GitHub Discussions",
    ],
    ctaLabel: "Read the install guide",
    ctaHref: "https://github.com/sjkncs/agentx#readme",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$49",
    cadence: "per user / month",
    tagline: "For teams that want priority support + commercial-use license.",
    highlighted: true,
    features: [
      "Everything in Community",
      "Commercial-use license for Pro skills (Slide Kit, deep research, …)",
      "Advanced skills: PPT-master, scientific-illustrator, ARIS auto-research (early access)",
      "Priority security updates and CVEs (≤48h disclosure)",
      "Per-step cost + token budget controls",
      "Email support (24h SLA)",
    ],
    ctaLabel: "Get a Pro license key",
    ctaHref: "mailto:sjkncs@example.com?subject=AgentX%20Pro%20inquiry",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    cadence: "annual",
    tagline: "For org-wide deployment with SSO, audit, and data-policy controls.",
    features: [
      "Everything in Pro",
      "SSO via OIDC / SAML / SCIM provisioning",
      "Audit log export (SOC2 + ISO 27001-aligned)",
      "Custom data-residency + field-masking policy templates",
      "On-prem-only mode (no outbound calls except the BYO-LLM provider)",
      "Dedicated support engineer + named CSM",
    ],
    ctaLabel: "Talk to us",
    ctaHref: "mailto:sjkncs@example.com?subject=AgentX%20Enterprise%20inquiry",
  },
];

const COMPARE_GROUPS: ReadonlyArray<{
  label: string;
  rows: ReadonlyArray<{ feature: string; community: string; pro: string; enterprise: string }>;
}> = [
  {
    label: "Install & license",
    rows: [
      { feature: "Single-machine install", community: "✓", pro: "✓", enterprise: "✓" },
      { feature: "Commercial-use license", community: "—", pro: "✓", enterprise: "✓" },
      { feature: "Air-gapped mode", community: "—", pro: "—", enterprise: "✓" },
    ],
  },
  {
    label: "Skill marketplace",
    rows: [
      { feature: "Bundled catalog (13 skills)", community: "✓", pro: "✓", enterprise: "✓" },
      { feature: "Custom GitHub installs", community: "✓", pro: "✓", enterprise: "✓" },
      { feature: "Pro-only skills", community: "—", pro: "✓", enterprise: "✓" },
      { feature: "Private skill registry", community: "—", pro: "—", enterprise: "✓" },
    ],
  },
  {
    label: "Run controls",
    rows: [
      { feature: "Multi-agent task graph", community: "✓", pro: "✓", enterprise: "✓" },
      { feature: "HITL checkpoints", community: "✓", pro: "✓", enterprise: "✓" },
      { feature: "Per-step cost budgets", community: "—", pro: "✓", enterprise: "✓" },
      { feature: "Audit log export", community: "—", pro: "—", enterprise: "✓" },
    ],
  },
  {
    label: "Data & security",
    rows: [
      { feature: "Local SQLite storage", community: "✓", pro: "✓", enterprise: "✓" },
      { feature: "Field-level masking", community: "✓", pro: "✓", enterprise: "✓" },
      { feature: "Custom data-residency policy", community: "—", pro: "—", enterprise: "✓" },
      { feature: "SSO / SAML / SCIM", community: "—", pro: "—", enterprise: "✓" },
    ],
  },
  {
    label: "Support",
    rows: [
      { feature: "GitHub Discussions", community: "✓", pro: "✓", enterprise: "✓" },
      { feature: "Email support (≤24h)", community: "—", pro: "✓", enterprise: "✓" },
      { feature: "Dedicated engineer + CSM", community: "—", pro: "—", enterprise: "✓" },
    ],
  },
];

export default function PricingPage() {
  return (
    <main>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>Pricing</span>
        <h1 className={styles.heroTitle}>
          Self-hosted today. Cloud and Enterprise when you ask for them.
        </h1>
        <p className={styles.heroSubtitle}>
          AgentX ships as a single-machine install you control. The
          Community tier is free. Pro adds a commercial license and
          priority security updates. Enterprise adds SSO, audit, and the
          data-policy controls an org needs.
        </p>
        <p className={styles.heroFootnote}>
          All plans include every bundled skill and every desktop-pet feature.
          The difference is license, support, and org controls.
        </p>
      </section>

      <section className={styles.section}>
        <div
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            alignItems: "stretch",
          }}
        >
          {TIERS.map((tier) => (
            <article
              key={tier.id}
              className={styles.featureCard}
              style={{
                borderColor: tier.highlighted ? "var(--foreground)" : "var(--border)",
                borderWidth: tier.highlighted ? 2 : 1,
                padding: 28,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--text-tertiary)",
                  marginBottom: 6,
                }}
              >
                {tier.name}
                {tier.highlighted ? " · Most popular" : ""}
              </div>
              <h3 style={{ fontSize: 24, margin: "0 0 4px 0", letterSpacing: "-0.01em" }}>
                {tier.name}
              </h3>
              <div style={{ margin: "8px 0 12px 0" }}>
                <span style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  {tier.price}
                </span>
                <span style={{ color: "var(--text-tertiary)", marginLeft: 8, fontSize: 14 }}>
                  {tier.cadence}
                </span>
              </div>
              <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 18px 0", lineHeight: 1.5 }}>
                {tier.tagline}
              </p>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "0 0 22px 0",
                  display: "grid",
                  gap: 8,
                  flexGrow: 1,
                }}
              >
                {tier.features.map((f) => (
                  <li
                    key={f}
                    style={{
                      display: "flex",
                      gap: 8,
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: "var(--text-secondary)",
                    }}
                  >
                    <span aria-hidden style={{ color: "var(--foreground)", fontWeight: 700 }}>✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={tier.ctaHref}
                className={tier.highlighted ? styles.buttonPrimary : styles.buttonSecondary}
              >
                {tier.ctaLabel} →
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Compare every feature</h2>
        </div>
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
            }}
          >
            <thead>
              <tr style={{ background: "var(--surface-subtle)" }}>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>
                  Feature
                </th>
                <th style={{ textAlign: "center", padding: "12px 16px", fontWeight: 600 }}>
                  Community
                </th>
                <th style={{ textAlign: "center", padding: "12px 16px", fontWeight: 600 }}>
                  Pro
                </th>
                <th style={{ textAlign: "center", padding: "12px 16px", fontWeight: 600 }}>
                  Enterprise
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPARE_GROUPS.map((group) => (
                <RowGroup key={group.label} label={group.label} rows={group.rows} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.cta}>
        <h2 className={styles.ctaTitle}>Start free, upgrade when you need.</h2>
        <p className={styles.ctaBody}>
          The Community install is the same code Pro and Enterprise ship.
          You can always export your workspace and re-import under a new
          license later.
        </p>
        <div className={styles.heroCtas}>
          <Link
            href="https://github.com/sjkncs/agentx#readme"
            className={styles.buttonPrimary}
          >
            Install AgentX →
          </Link>
          <Link href="/skills" className={styles.buttonSecondary}>
            Browse the catalog first
          </Link>
        </div>
      </section>
    </main>
  );
}

function RowGroup({
  label,
  rows,
}: {
  label: string;
  rows: ReadonlyArray<{ feature: string; community: string; pro: string; enterprise: string }>;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={4}
          style={{
            padding: "10px 16px",
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--text-tertiary)",
            background: "var(--surface-subtle)",
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
            fontWeight: 600,
          }}
        >
          {label}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.feature}>
          <td style={{ padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
            {r.feature}
          </td>
          <td style={{ padding: "10px 16px", textAlign: "center", borderTop: "1px solid var(--border)" }}>
            {r.community}
          </td>
          <td style={{ padding: "10px 16px", textAlign: "center", borderTop: "1px solid var(--border)" }}>
            {r.pro}
          </td>
          <td style={{ padding: "10px 16px", textAlign: "center", borderTop: "1px solid var(--border)" }}>
            {r.enterprise}
          </td>
        </tr>
      ))}
    </>
  );
}
