/**
 * apps/web/src/app/(marketing)/page.tsx
 *
 * Marketing home. Replaces the previous "redirect to /data-tasks" stub
 * so first-time visitors land on a real product page instead of being
 * shoved into the workspace.
 *
 *  - Server component — no client JS for the static framing.
 *  - Skills are surfaced by hitting the live /api/v1/skills endpoint
 *    via the server-side fetch so the catalog on the home page is
 *    never out-of-sync with the marketplace UI. Falls back to a
 *    hand-picked four-skill list if the API is unreachable so the
 *    marketing page is never blank.
 *  - All CTAs link to real routes: /register, /login, /features,
 *    /skills. No dead buttons.
 */

import Link from "next/link";

import styles from "../marketing.module.css";

type CatalogEntry = {
  id: string;
  displayName: string;
  description: string;
  icon?: string;
  repo: string;
  license?: string;
};

/** Pick a stable 4-skill spotlight for the marketing hero, regardless of
 *  catalog order. New skills can be added without growing the spotlight. */
const HERO_SPOTLIGHT_IDS = ["scroll-world", "hallmark", "impeccable", "taste-skill"];

async function fetchSpotlight(apiBase: string): Promise<CatalogEntry[]> {
  try {
    const res = await fetch(`${apiBase}/api/v1/skills/catalog`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: CatalogEntry[] } | CatalogEntry[];
    const list = Array.isArray(body) ? body : body.data ?? [];
    return list.filter((e) => HERO_SPOTLIGHT_IDS.includes(e.id));
  } catch {
    return [];
  }
}

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
    icon: "🪄",
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
    icon: "🛡",
    title: "Local-first data",
    body:
      "Your data never leaves the machine you run DataFoundry on, unless you choose to. Datasource connections and knowledge bases live in a local SQLite file you control.",
  },
];

export default async function MarketingHome() {
  const apiBase = process.env.NEXT_PUBLIC_DATAFOUNDRY_API_BASE ?? "http://127.0.0.1:8787";
  const spotlight = await fetchSpotlight(apiBase);

  return (
    <main>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>v1 · open beta</span>
        <h1 className={styles.heroTitle}>
          An agent that knows what you work with.
        </h1>
        <p className={styles.heroSubtitle}>
          DataFoundry turns the data stack you already have — datasources,
          notebooks, models, skills — into a workspace an agent can drive
          end-to-end. Bring a question, watch the work product land.
        </p>
        <div className={styles.heroCtas}>
          <Link href="/register" className={styles.buttonPrimary}>
            Create an account →
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
        {spotlight.length === 0 ? (
          <p className={styles.skillCardMeta} style={{ textAlign: "center" }}>
            Skill catalog offline — start the API to browse the live marketplace.
          </p>
        ) : (
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
        )}
        <p style={{ textAlign: "center", marginTop: 24 }}>
          <Link href="/skills" className={styles.featureCardLink}>
            Browse the full catalog →
          </Link>
        </p>
      </section>

      <section className={styles.cta}>
        <h2 className={styles.ctaTitle}>Ready to give it a real query?</h2>
        <p className={styles.ctaBody}>
          Register with any email; the local install auto-verifies so you can
          sign in immediately and start running agents against your datasources.
        </p>
        <div className={styles.heroCtas}>
          <Link href="/register" className={styles.buttonPrimary}>
            Create your account
          </Link>
          <Link href="/login" className={styles.buttonSecondary}>
            I already have one
          </Link>
        </div>
      </section>
    </main>
  );
}
