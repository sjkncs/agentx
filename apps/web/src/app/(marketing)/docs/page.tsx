/**
 * apps/web/src/app/(marketing)/docs/page.tsx
 *
 * Public-facing "getting started" page that mirrors what's actually
 * in the repo today. Every command / path shown here is a real file
 * in the workspace; nothing is aspirational.
 *
 * Sections:
 *   1. Install — node + pnpm + clone + bootstrap.
 *   2. First run — env setup, register, sign in, run an agent.
 *   3. Add a skill — install from the bundled catalog, install from
 *      a GitHub repo.
 *   4. Add a desktop pet — launch the desktop app, build a persona.
 *   5. Where to look in the source — points at real directories.
 */

import Link from "next/link";

import styles from "../../marketing.module.css";

const STEPS: ReadonlyArray<{
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets: ReadonlyArray<{ k: string; v: string }>;
}> = [
  {
    id: "install",
    eyebrow: "Install",
    title: "Get the source and install dependencies.",
    body:
      "DataFoundry is a pnpm workspaces monorepo. You'll need Node 20+ and pnpm 9. The install is local — no Docker required for development.",
    bullets: [
      { k: "Clone", v: "git clone the repo and cd into the workspace root." },
      { k: "Install", v: "pnpm install at the root. ~600 MB of disk; first run takes 1–3 minutes." },
      { k: "Build", v: "pnpm --filter @datafoundry/api build && pnpm --filter @datafoundry/web build." },
      { k: "Optional: desktop", v: "pnpm --filter @datafoundry/desktop dist:dir to bundle the Electron companion app." },
    ],
  },
  {
    id: "first-run",
    eyebrow: "First run",
    title: "Set your environment and register.",
    body:
      "The local install ships with a .env.example that documents every required variable. The auth module is auto-verified in test mode so you can sign in immediately after registration.",
    bullets: [
      { k: "API auth", v: "AUTH_REGISTRATION_MODE=open, AUTH_SESSION_SECRET=<32+ chars>, AUTH_PUBLIC_BASE_URL=http://127.0.0.1:8787, AUTH_EMAIL_DELIVERY=test." },
      { k: "Run the API", v: "node apps/api/dist/server.js — listens on :8787. Run `node apps/web/.next/standalone/server.js` after `pnpm --filter @datafoundry/web start` for :3000." },
      { k: "Register", v: "Open /register on :3000, any email + password (≥6 chars). Auto-verifies in test mode." },
      { k: "Sign in", v: "Open /login — back into the same session. The same browser session is also what powers the desktop pet companion app." },
    ],
  },
  {
    id: "skills",
    eyebrow: "Add a skill",
    title: "Browse, install, and sync skills.",
    body:
      "The marketplace API runs at /api/v1/skill-marketplace. The bundled catalog is in packages/skills/builtin/skill-catalog.json — add a new entry there and the API picks it up on next boot.",
    bullets: [
      { k: "Browse", v: "GET /api/v1/skill-marketplace/catalog — returns 13 entries out of the box." },
      { k: "Install", v: "POST /api/v1/skill-marketplace/install with { id } — fetches SKILL.md from upstream GitHub, hashes the file, and persists the install to file assets + metadata store." },
      { k: "Sync", v: "POST /api/v1/skill-marketplace/sync re-fetches every installed skill, computes SHA-256 of the SKILL.md, and writes a new snapshot only if the upstream changed." },
      { k: "Audit", v: "Every install/sync/uninstall writes a row to fsf_messages and dfd_audit_events so the operator panel has a real history." },
    ],
  },
  {
    id: "pet",
    eyebrow: "Add a desktop pet",
    title: "Spawn a companion with a persona you designed.",
    body:
      "The Electron companion is bundled in apps/desktop. After npm install + dist:dir, the app launches in the system tray. Right-click → 'Add a pet…' opens the persona builder.",
    bullets: [
      { k: "Reference images", v: "Upload 1–4 PNG/JPEG/WebP images of any character or artwork. The builder hashes each (SHA-256) and stores pointers only — the originals never leave your machine." },
      { k: "VLM suggestion", v: "Click 'Describe with VLM' to call the v0.1 /api/v1/vlm/describe endpoint. Deterministic placeholder for now; real provider slot is wired and ready to plug." },
      { k: "Save", v: "Save writes the persona to pet-state.json in userData. Re-open from the tray at any time." },
      { k: "Modes", v: "Work mode → full harness. Companion mode → persona-scoped toolset + disclaimer modal that has to be acknowledged the first time per session." },
    ],
  },
  {
    id: "source",
    eyebrow: "Where to look",
    title: "Source map for the curious.",
    body:
      "Every page on the marketing site points at a real directory. If you want to understand why a feature works the way it does, start here.",
    bullets: [
      { k: "Marketing site", v: "apps/web/src/app/(marketing) — the hero, features, pricing, skills, docs pages you are reading." },
      { k: "Skill marketplace", v: "packages/skills + apps/api/src/routes/skill-marketplace.ts + apps/web/src/app/admin/skill-marketplace." },
      { k: "Skill sync worker", v: "apps/api/src/skill-sync.ts (background 6h loop). Audit table dfd_audit_events." },
      { k: "Desktop pet", v: "apps/desktop/src/pet/ — schema (persona.mjs), store (persona-store.mjs), builder, chat window, voice adapter." },
      { k: "Supabase schema", v: "docs/services/supabase-integration/003_food_safety_schema.sql + 012_run_persistence_schema.sql for memory bank + eval pipeline." },
    ],
  },
];

export default function DocsPage() {
  return (
    <main>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>Docs</span>
        <h1 className={styles.heroTitle}>
          How to run DataFoundry from a clean checkout.
        </h1>
        <p className={styles.heroSubtitle}>
          Every command / path on this page is a real file in the
          repository. If a step on this page stops working, the bug is
          in the source — open an issue with the path.
        </p>
        <div className={styles.heroCtas}>
          <Link href="/register" className={styles.buttonPrimary}>
            Register an account →
          </Link>
          <Link href="/skills" className={styles.buttonSecondary}>
            Browse the catalog
          </Link>
        </div>
      </section>

      <section className={styles.section}>
        {STEPS.map((section, idx) => (
          <article
            key={section.id}
            id={section.id}
            className={styles.featureCard}
            style={{
              padding: 28,
              marginBottom: 24,
              borderTop: idx > 0 ? "1px solid var(--border)" : undefined,
            }}
          >
            <div className={styles.sectionEyebrow}>{section.eyebrow}</div>
            <h2 className={styles.sectionTitle} style={{ marginBottom: 12 }}>
              {section.title}
            </h2>
            <p
              style={{
                fontSize: 16,
                color: "var(--text-secondary)",
                lineHeight: 1.55,
                margin: "0 0 18px 0",
              }}
            >
              {section.body}
            </p>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "grid",
                gap: 12,
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
                    padding: "14px 16px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 4,
                    }}
                  >
                    {b.k}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      lineHeight: 1.5,
                      fontFamily: "var(--font-fira-code)",
                    }}
                  >
                    {b.v}
                  </div>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className={styles.cta}>
        <h2 className={styles.ctaTitle}>Need a feature we don't document?</h2>
        <p className={styles.ctaBody}>
          Open an issue. The marketing site and the docs live in the
          same monorepo as the rest of the product, so any
          improvement you file is one PR away from being live.
        </p>
        <div className={styles.heroCtas}>
          <Link href="/register" className={styles.buttonPrimary}>
            Get started →
          </Link>
          <Link href="/features" className={styles.buttonSecondary}>
            Back to features
          </Link>
        </div>
      </section>
    </main>
  );
}