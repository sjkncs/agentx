/**
 * apps/marketing/src/app/(marketing)/page.tsx
 *
 * Marketing home. Mirrors apps/web/src/app/(marketing)/page.tsx but
 * drops the live /api/v1/skill-marketplace/catalog fetch (the GitHub
 * Pages build has no API runtime). The 4-card hero spotlight is
 * statically bundled from src/data/skill-catalog.ts — update there
 * to change what the homepage advertises.
 */
import Link from "next/link";

import { SKILL_CATALOG } from "../../data/skill-catalog";

import styles from "../marketing.module.css";

const HERO_SPOTLIGHT_IDS = ["scroll-world", "hallmark", "impeccable", "taste-skill"] as const;

const FEATURE_HIGHLIGHTS = [
  {
    icon: "🧭",
    title: "Multi-agent task graph",
    body:
      "Plan a data task with one orchestrator agent and worker sub-agents. Inspect, query, transform, visualise, fetch — the same verbs that exist in a notebook, now expressed as typed steps with audit trails.",
  },
  {
    icon: "🛠",
    title: "Skill marketplace",
    body:
      "Add new verbs without forking the codebase. Browse the bundled catalog (TDD, MCP, Slide Kit, D3, deep research, …) or install any SKILL.md-compatible GitHub skill with one command.",
  },
  {
    icon: "�",
    title: "Custom personas (desktop pet)",
    body:
      "Spin up a desktop pet that adopts a voice and posture you choose. Switch to companion mode for warmer small talk, work mode for the full harness — with persona-scoped tool guardrails.",
  },
  {
    icon: "🔌",
    title: "Bring-your-own model",
    body:
      "Works with any provider your team approves: Anthropic, OpenAI, Qwen, DeepSeek, local Ollama. The runtime never locks your data into a single model vendor.",
  },
  {
    icon: "📦",
    title: "Artifacts you can ship",
    body:
      "Every run emits downloadable artifacts: CSV/Parquet tables, slide decks, dashboards, fine-tuned model cards, generated code diffs. The same artifact endpoints power the workspace and the dashboard.",
  },
  {
    icon: "�",
    title: "Local-first data",
    body:
      "Your data never leaves the machine you run AgentX on, unless you choose to. Datasource connections and knowledge bases live in a local SQLite file you control.",
  },
];

export default function MarketingHome() {
  const spotlight = SKILL_CATALOG.filter((s) =>
    HERO_SPOTLIGHT_IDS.includes(s.id as (typeof HERO_SPOTLIGHT_IDS)[number]),
  );

  return (
    <main>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>v1 · open beta</span>
        <h1 className={styles.heroTitle}>
          An agent that knows what you work with.
        </h1>
        <p className={styles.heroSubtitle}>
          AgentX turns the data stack you already have — datasources,
          notebooks, models, skills — into a workspace an agent can drive
          end-to-end. Bring a question, watch the work product land.
        </p>
        <div className={styles.heroCtas}>
          <Link
            href="https://github.com/sjkncs/agentx#readme"
            className={styles.buttonPrimary}
          >
            Get started →
          </Link>
          <Link href="/features" className={styles.buttonSecondary}>
            See what it does
          </Link>
        </div>
        <p className={styles.heroFootnote}>
          Single-machine install · SQLite + file assets · Bring-your-own LLM
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionEyebrow}>Features</div>
          <h2 className={styles.sectionTitle}>
            Built for real data work, not toy demos
          </h2>
          <p className={styles.sectionSubtitle}>
            Every feature is wired against the live API. Every button hits a
            real endpoint. The same UI you saw in the demo is the UI you ship.
          </p>
        </div>
        <div className={styles.featureGrid}>
          {FEATURE_HIGHLIGHTS.map((f) => (
            <article key={f.title} className={styles.featureCard}>
              <div className={styles.featureCardIcon} aria-hidden>
                {f.icon}
              </div>
              <h3 className={styles.featureCardTitle}>{f.title}</h3>
              <p className={styles.featureCardBody}>{f.body}</p>
              <Link href="/features" className={styles.featureCardLink}>
                Learn more →
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div className={styles.sectionEyebrow}>Skill catalog</div>
          <h2 className={styles.sectionTitle}>
            Plug a new agent skill with one click
          </h2>
          <p className={styles.sectionSubtitle}>
            The marketplace ships with open-source skills curated for design,
            research, documentation, and engineering work — and accepts any
            SKILL.md-compatible GitHub repo.
          </p>
        </div>
        <div className={styles.skillGrid}>
          {spotlight.map((s) => (
            <Link
              key={s.id}
              href={`/skills#${s.id}`}
              className={styles.skillCard}
            >
              <span className={styles.skillCardIcon} aria-hidden>
                {s.icon ?? "•"}
              </span>
              <div className={styles.skillCardTitle}>{s.displayName}</div>
              <p className={styles.skillCardDesc}>{s.description}</p>
              <div className={styles.skillCardMeta}>
                {s.repo} · {s.license ?? "?"}
              </div>
            </Link>
          ))}
        </div>
        <p style={{ textAlign: "center", marginTop: 24 }}>
          <Link href="/skills" className={styles.featureCardLink}>
            Browse the full catalog →
          </Link>
        </p>
      </section>

      <section className={styles.cta}>
        <h2 className={styles.ctaTitle}>Ready to give it a real query?</h2>
        <p className={styles.ctaBody}>
          Clone the repo, follow the getting-started guide, and you can
          sign in immediately and start running agents against your
          datasources.
        </p>
        <div className={styles.heroCtas}>
          <Link
            href="https://github.com/sjkncs/agentx#readme"
            className={styles.buttonPrimary}
          >
            Read the docs
          </Link>
          <Link
            href="https://github.com/sjkncs/agentx"
            className={styles.buttonSecondary}
          >
            Browse the source
          </Link>
        </div>
      </section>
    </main>
  );
}
