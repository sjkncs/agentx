/**
 * apps/marketing/src/app/(marketing)/features/page.tsx
 *
 * Long-form deep dive, four sections. Verbatim copy of
 * apps/web/src/app/(marketing)/features/page.tsx with only the
 * marketing.module.css import path adjusted.
 */
import Link from "next/link";

import styles from "../../marketing.module.css";

const SECTIONS: ReadonlyArray<{
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets: ReadonlyArray<{ k: string; v: string }>;
  showMe: { href: string; label: string };
}> = [
  {
    id: "agents",
    eyebrow: "Multi-agent task graph",
    title: "Run multiple agents in one workspace.",
    body:
      "DataFoundry spawns an orchestrator that delegates to typed worker agents — inspect, query, transform, visualise, fetch, reason — every step recorded with its own trace. You watch the work product land instead of a wall of stream-of-consciousness tokens.",
    bullets: [
      { k: "Typed steps", v: "Each agent run is anchored to a step type so the runtime can bound side-effects (no surprise writes)." },
      { k: "Live trace", v: "Per-step token counts, latencies, tool calls, and approval points. Hover any step for the model's reasoning summary." },
      { k: "HITL", v: "Pause at human-input checkpoints for approvals on irreversible actions. The pause point is a real artifact the user can save and replay." },
      { k: "Resume from anywhere", v: "Every step is checkpointed. Reload mid-run, switch tabs, come back tomorrow — pick up where the runtime stopped." },
    ],
    showMe: { href: "/docs", label: "Open the getting started →" },
  },
  {
    id: "skills",
    eyebrow: "Skill marketplace",
    title: "Add new agent capabilities without a fork.",
    body:
      "Anything wrapped in a SKILL.md — TDD discipline, MCP builder, deep research, Slide Kit decks, D3 charts, anti-AI-slop design rules — installs with one click. Upstream GitHub repos, MIT license, signed install receipt in your local SQLite.",
    bullets: [
      { k: "Bundled catalog", v: "13 skills out of the box (TDD, MCP Builder, Slide Kit, D3, deep-research, food-safety + the 4 design/marketing skills: Scroll World, Hallmark, Impeccable, Taste Skill)." },
      { k: "Custom installs", v: "Paste any owner/name on GitHub; the runtime clones it, parses SKILL.md frontmatter, and registers it for the next run." },
      { k: "Strict permissions", v: "Companion mode strips side-effectful tools. Skill execution cannot bypass the permission layer even if the SKILL.md says so." },
      { k: "Lifecycle", v: "Update / disable / delete with a single click. The local SQLite keeps an audit trail of every version you've installed." },
    ],
    showMe: { href: "/skills", label: "Browse the catalog →" },
  },
  {
    id: "persona",
    eyebrow: "Custom personas (desktop pet)",
    title: "A character you control, on the desktop.",
    body:
      "The companion app spawns an always-on-top pet with a persona you designed. Switch to companion mode for warmer small talk with safety guardrails, work mode for the full harness. The persona prompt, voice, and forbidden tools are yours to edit.",
    bullets: [
      { k: "From your images", v: "Upload 1–4 reference images, the builder suggests a name + archetype + mood. No bundled preset characters — every pet starts from your input." },
      { k: "Voice or text", v: "Web Speech adapter covers zh-CN + en-US; Whisper / Qwen-TTS slots in via the pluggable voice-adapter interface." },
      { k: "Companion guardrails", v: "Persona-scoped toolset strips submit_plan / ask_user / publish_dataset in companion mode. Verbatim disclaimer block from spec §7.2." },
      { k: "Persistent", v: "Personas survive app restart. Stored in your local userData as JSON. Export / import for backup or sharing with friends (your data, your choice)." },
    ],
    showMe: { href: "/docs", label: "Read the docs →" },
  },
  {
    id: "data",
    eyebrow: "Local-first data + BYO model",
    title: "Your data and your model choice, not ours.",
    body:
      "Every datasource, knowledge base, and skill install lives in a local SQLite file under workspace dir. The runtime never locks you to a single model vendor: switch between Anthropic, OpenAI, Qwen, DeepSeek, Ollama — with full trace visibility into which model answered which step.",
    bullets: [
      { k: "Bring-your-own LLM", v: "Provider selection per run, per step, or per skill. The runtime accepts any provider the contracts package supports." },
      { k: "Local datasources", v: "CSV, Parquet, SQLite, DuckDB, JSON, Excel, scanned PDFs. Field-level masking policy; sampling policy. No data leaves your machine unless you ship to a cloud provider explicitly." },
      { k: "Knowledge bases", v: "Chunking + citation policies in scope. Citations are real — every retrieved chunk is named in the trace." },
      { k: "Artifact endpoints", v: "Same artifact API used by the workspace UI is the one your scripts hit. Export programmatically; import back from CLI." },
    ],
    showMe: { href: "/docs", label: "See the install guide →" },
  },
];

export default function FeaturesPage() {
  return (
    <main>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>Features</span>
        <h1 className={styles.heroTitle}>
          Built for real data work, not toy demos.
        </h1>
        <p className={styles.heroSubtitle}>
          Every section below links to a real surface in the product. If a
          link breaks, the product broke — and we fix it before the link
          does. No dead buttons, no placeholder flows.
        </p>
        <div className={styles.heroCtas}>
          <Link
            href="https://github.com/sjkncs/agentx#readme"
            className={styles.buttonPrimary}
          >
            Get started →
          </Link>
          <Link href="/pricing" className={styles.buttonSecondary}>
            See pricing
          </Link>
        </div>
      </section>

      {SECTIONS.map((section, idx) => (
        <section
          key={section.id}
          id={section.id}
          className={styles.section}
          style={{
            paddingTop: idx === 0 ? 32 : undefined,
            borderTop: idx > 0 ? "1px solid var(--border)" : undefined,
          }}
        >
          <div
            style={{
              maxWidth: 760,
              margin: "0 0 32px 0",
            }}
          >
            <div className={styles.sectionEyebrow}>{section.eyebrow}</div>
            <h2 className={styles.sectionTitle}>{section.title}</h2>
            <p
              style={{
                fontSize: 17,
                lineHeight: 1.6,
                color: "var(--text-secondary)",
                margin: 0,
              }}
            >
              {section.body}
            </p>
          </div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            }}
          >
            {section.bullets.map((b) => (
              <li
                key={b.k}
                style={{
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "18px 20px",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--foreground)",
                    marginBottom: 6,
                  }}
                >
                  {b.k}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: "var(--text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  {b.v}
                </div>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 24 }}>
            <Link href={section.showMe.href} className={styles.featureCardLink}>
              {section.showMe.label}
            </Link>
          </div>
        </section>
      ))}

      <section className={styles.cta}>
        <h2 className={styles.ctaTitle}>Try the catalog now.</h2>
        <p className={styles.ctaBody}>
          The marketplace already has 13 skills live. Take a look at the
          build, audit, and deploy skills — they change what an agent can
          do today.
        </p>
        <div className={styles.heroCtas}>
          <Link href="/skills" className={styles.buttonPrimary}>
            Open the catalog →
          </Link>
          <Link href="/pricing" className={styles.buttonSecondary}>
            See pricing
          </Link>
        </div>
      </section>
    </main>
  );
}
