/**
 * apps/marketing/src/app/(marketing)/skills/page.tsx
 *
 * Public skill catalog browse. Static — no API fetch — backed by
 * src/data/skill-catalog.ts. Mirrors the live page's fallback list
 * (apps/web/src/app/(marketing)/skills/page.tsx FALLBACK_ENTRIES) so
 * the GitHub Pages site shows the same 13 entries as the local install.
 */
import Link from "next/link";

import { SKILL_CATALOG, SKILL_CATEGORY_ORDER } from "../../../data/skill-catalog";

import styles from "../../marketing.module.css";

export default function SkillsPage() {
  const entries = SKILL_CATALOG;

  const grouped = new Map<string, typeof entries[number][]>();
  for (const e of entries) {
    const key = (e.category ?? "other") as string;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(e);
  }
  const orderedCategories = [
    ...SKILL_CATEGORY_ORDER.filter((c) => grouped.has(c)),
    ...[...grouped.keys()].filter((c) => !SKILL_CATEGORY_ORDER.includes(c as typeof SKILL_CATEGORY_ORDER[number])),
  ];

  return (
    <main>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>Skill catalog</span>
        <h1 className={styles.heroTitle}>
          Plug a new agent capability with one click.
        </h1>
        <p className={styles.heroSubtitle}>
          Every skill below is a SKILL.md-compatible GitHub repo, installable
          with one command against the local marketplace endpoint. Click any
          card to open its upstream homepage.
        </p>
        <p className={styles.heroFootnote}>
          Showing {entries.length} bundled skills.
        </p>
      </section>

      <section className={styles.section}>
        {orderedCategories.length === 0 ? (
          <p style={{ textAlign: "center", color: "var(--text-tertiary)" }}>
            No skills available.
          </p>
        ) : (
          orderedCategories.map((category) => {
            const items = grouped.get(category) ?? [];
            return (
              <div key={category} style={{ marginBottom: 36 }}>
                <h2
                  style={{
                    fontSize: 14,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--text-tertiary)",
                    margin: "0 0 14px 0",
                    borderBottom: "1px solid var(--border)",
                    paddingBottom: 6,
                  }}
                >
                  {category} ({items.length})
                </h2>
                <div className={styles.skillGrid}>
                  {items.map((s) => (
                    <SkillCard key={s.id} skill={s} />
                  ))}
                </div>
              </div>
            );
          })
        )}
        <p style={{ textAlign: "center", marginTop: 32 }}>
          <Link
            href="https://github.com/sjkncs/agentx#readme"
            className={styles.featureCardLink}
          >
            Read the install guide →
          </Link>
        </p>
      </section>
    </main>
  );
}

function SkillCard({ skill }: { skill: typeof SKILL_CATALOG[number] }) {
  const href = skill.homepage ?? `https://github.com/${skill.repo}`;
  return (
    <a
      id={skill.id}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.skillCard}
    >
      <span className={styles.skillCardIcon} aria-hidden>
        {skill.icon ?? "•"}
      </span>
      <div className={styles.skillCardTitle}>
        {skill.displayName}
        {skill.builtin ? (
          <span
            style={{
              marginLeft: 6,
              fontSize: 10,
              padding: "2px 6px",
              border: "1px solid var(--border)",
              borderRadius: 999,
              color: "var(--text-tertiary)",
            }}
          >
            BUILT-IN
          </span>
        ) : null}
      </div>
      <p className={styles.skillCardDesc}>{skill.description}</p>
      <div className={styles.skillCardMeta}>
        {skill.repo} · {skill.license ?? "?"}
      </div>
    </a>
  );
}
