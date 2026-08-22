/**
 * apps/web/src/app/(marketing)/skills/page.tsx
 *
 * Public skill catalog browse. Server component; fetches the live
 * /api/v1/skill-marketplace/catalog endpoint and renders every entry.
 * Falls back to an "API unreachable" notice (with the list of bundled
 * skills hard-coded) if the API is down, so the page is never blank.
 *
 * URL fragment anchors (#scroll-world, #hallmark, ...) link from the
 * marketing home so users can deep-link directly to a skill card.
 */

import Link from "next/link";

import styles from "../../marketing.module.css";

type CatalogEntry = {
  id: string;
  displayName: string;
  description: string;
  category?: string;
  tags?: string[];
  repo: string;
  homepage?: string;
  license?: string;
  icon?: string;
  builtin?: boolean;
};

type CatalogResponse = {
  items?: CatalogEntry[];
  data?: CatalogEntry[];
};

async function fetchCatalog(apiBase: string): Promise<{
  online: boolean;
  entries: CatalogEntry[];
}> {
  try {
    const res = await fetch(`${apiBase}/api/v1/skill-marketplace/catalog`, {
      cache: "no-store",
    });
    if (!res.ok) return { online: false, entries: [] };
    const body = (await res.json()) as CatalogResponse | CatalogEntry[];
    const list = Array.isArray(body) ? body : body.items ?? body.data ?? [];
    return { online: true, entries: list };
  } catch {
    return { online: false, entries: [] };
  }
}

/** Hard-coded fallback list shown if the API is down so the marketing
 *  page still advertises what ships out of the box. Mirrors
 *  packages/skills/builtin/skill-catalog.json as of e6f3cf3. */
const FALLBACK_ENTRIES: ReadonlyArray<CatalogEntry> = [
  {
    id: "slide-kit",
    displayName: "Slide Kit",
    description: "Write editable .pptx decks in Python. 17 slide types, 4 themes, real charts, Gemini-powered diagrams.",
    category: "documents",
    repo: "PHY041/claude-skill-slide-kit",
    license: "MIT",
    icon: "🎞️",
  },
  {
    id: "anydesign",
    displayName: "AnyDesign",
    description: "Analyzes any image, URL, or Figma file and emits a structured design.md with the full design system.",
    category: "science",
    repo: "uxKero/anydesign",
    license: "MIT",
    icon: "🔬",
  },
  {
    id: "swiftui-design",
    displayName: "SwiftUI Design",
    description: "SwiftUI front-end design skill — anti-AI-Slop six rules, design-direction advisor, brand-asset protocol.",
    category: "design",
    repo: "wholiver/swiftui-design-skill",
    license: "MIT",
    icon: "✉️",
  },
  {
    id: "tdd",
    displayName: "Test-Driven Development",
    description: "TDD discipline, red-green-refactor, and regression coverage. Source: obra/superpowers.",
    category: "engineering",
    repo: "obra/superpowers",
    license: "MIT",
    icon: "✨",
  },
  {
    id: "brainstorming",
    displayName: "Brainstorming",
    description: "Transform rough ideas into fully-formed designs through structured questioning.",
    category: "writing",
    repo: "obra/superpowers",
    license: "MIT",
    icon: "🧠",
  },
  {
    id: "mcp-builder",
    displayName: "MCP Builder",
    description: "Guides creation of high-quality MCP servers. Source: anthropics/skills.",
    category: "automation",
    repo: "anthropics/skills",
    license: "Proprietary",
    icon: "🌐",
  },
  {
    id: "deep-research",
    displayName: "Deep Research",
    description: "Execute autonomous multi-step research using Gemini Deep Research Agent.",
    category: "research",
    repo: "sanjay3290/ai-skills",
    license: "MIT",
    icon: "🌙",
  },
  {
    id: "d3js-vis",
    displayName: "D3.js Visualization",
    description: "Teaches Claude to produce D3 charts and interactive data visualizations.",
    category: "creative",
    repo: "chrisvoncsefalvay/claude-d3js-skill",
    license: "MIT",
    icon: "📊",
  },
  {
    id: "food-safety",
    displayName: "Food Safety (Heytea)",
    description: "Multi-subagent food-safety customer-service skill: intent classification, compliance reply, audit, and work-order generation. Built-in.",
    category: "vertical",
    repo: "sjkncs/data-agent-examples",
    license: "Apache-2.0",
    icon: "🍵",
    builtin: true,
  },
  {
    id: "scroll-world",
    displayName: "Scroll World",
    description: "Build immersive scroll-scrubbed 'fly through the world' landing pages — Apple-style continuous 3D camera flight driven by scroll position.",
    category: "creative",
    repo: "oso95/scroll-world",
    license: "MIT",
    icon: "🌐",
  },
  {
    id: "hallmark",
    displayName: "Hallmark (Anti-AI-slop Design)",
    description: "Anti-AI-slop design skill: build / audit / redesign / study. Source: Nutlope/hallmark.",
    category: "design",
    repo: "Nutlope/hallmark",
    license: "MIT",
    icon: "✨",
  },
  {
    id: "impeccable",
    displayName: "Impeccable (Design Vocabulary)",
    description: "23-command design vocabulary plugin reading PRODUCT.md / DESIGN.md with ~59 deterministic detector rules.",
    category: "design",
    repo: "pbakaus/impeccable",
    license: "MIT",
    icon: "🎨",
  },
  {
    id: "taste-skill",
    displayName: "Taste Skill (Anti-slop Frontend)",
    description: "Anti-slop frontend skill with three dials (DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY).",
    category: "design",
    repo: "Leonxlnx/taste-skill",
    license: "MIT",
    icon: "👁️",
  },
];

const CATEGORY_ORDER = [
  "design",
  "creative",
  "documents",
  "engineering",
  "research",
  "automation",
  "writing",
  "vertical",
  "science",
  "other",
];

export default async function SkillsPage() {
  const apiBase = process.env.NEXT_PUBLIC_DATAFOUNDRY_API_BASE ?? "http://127.0.0.1:8787";
  const { online, entries: liveEntries } = await fetchCatalog(apiBase);
  const entries = online && liveEntries.length > 0 ? liveEntries : FALLBACK_ENTRIES;
  const source = online ? "live" : "fallback";

  const grouped = new Map<string, CatalogEntry[]>();
  for (const e of entries) {
    const key = (e.category ?? "other") as string;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(e);
  }
  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => grouped.has(c)),
    ...[...grouped.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return (
    <main>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>Skill catalog</span>
        <h1 className={styles.heroTitle}>
          Plug a new agent capability with one click.
        </h1>
        <p className={styles.heroSubtitle}>
          Every skill below is a SKILL.md-compatible GitHub repo, fetched
          live from our catalog endpoint. Click any card to open its
          upstream homepage.
        </p>
        <p className={styles.heroFootnote}>
          {source === "live"
            ? `Showing ${entries.length} skills (live, fetched from the API just now).`
            : "Showing the bundled catalog. The API is offline — start the local server to see live marketplace data."}
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
          <Link href="/register" className={styles.featureCardLink}>
            Register to install any of these →
          </Link>
        </p>
      </section>
    </main>
  );
}

function SkillCard({ skill }: { skill: CatalogEntry }) {
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
