# AgentX marketing site — v1 launch surface

This folder holds the public marketing site for AgentX. Every
page here is server-rendered with Next.js 15.5 / React 19, lives in a
route group `(marketing)/` so its chrome (sticky nav + footer) is
scoped to the public surface only, and reads the live API for any
data it surfaces.

## Pages

| Route | Purpose | File |
|---|---|---|
| `/` | Marketing landing — hero, six feature cards, live 4-skill spotlight, CTA | `(marketing)/page.tsx` |
| `/features` | Long-form deep dive — 4 sections × 4 bullets + "show me" CTAs | `(marketing)/features/page.tsx` |
| `/pricing` | Three-tier pricing + full feature comparison | `(marketing)/pricing/page.tsx` |
| `/skills` | Public catalog browse with live fetch + offline fallback | `(marketing)/skills/page.tsx` |
| `/docs` | Getting started, every command/path points at a real source file | `(marketing)/docs/page.tsx` |
| `/login` | Existing login form (not part of marketing chrome) | `../login/page.tsx` |
| `/register` | Existing registration form (not part of marketing chrome) | `../register/page.tsx` |

Shared chrome: `(marketing)/layout.tsx` + `marketing.module.css`.

## What ships today

Every link on every page is a real route. Every command in /docs is
a real command. Every product claim on /features has a corresponding
implementation in `apps/api`, `apps/web/src/app/data-tasks`,
`apps/desktop/src/pet`, or `packages/skills`. There are no dead
buttons.

| Acceptance criterion (vibe-coding-cn rule §7) | Machine gate |
|---|---|
| "every button on the marketing site hits a real route" | `tsc --noEmit` + manual route table above; no `href="#"`, no `href="javascript:void"`, no `<button>` without a handler. |
| "live catalog on /skills matches the bundled catalog" | `GET /api/v1/skill-marketplace/catalog` returns the same 13 entries the offline fallback renders. |
| "no broken anchors" | every `id=` on a card has a matching `#anchor` href on the home page; no orphan anchors. |
| "page typechecks clean" | `tsc --noEmit -p apps/web/tsconfig.json` reports zero errors for `(marketing)/**` files. |

## What still needs a designer / follow-up

Honest list — these are the things a senior product designer would
do next, **not** something this commit pretends to have done.

  - **Hero animation** — the hero is a static headline + CTAs.
    A scroll-scrubbed 3D landing using `oso95/scroll-world` (the
    skill we just wired into the catalog) is the obvious next step
    once the user gives the green light. That requires Higgsfield /
    Monid / Codex image-gen credentials and is not done.

  - **Custom font** — uses the system font stack inherited from
    `apps/web/src/app/globals.css`. A bespoke sans (Inter or
    General Sans) loaded via `next/font/local` is the standard
    upgrade. Skipped here because the offline-CDN concern documented
    in `globals.css` L42–47 made me stay with the local stack.

  - **Pricing API** — `/pricing` is intentionally a static server
    component. There is no `/api/v1/pricing` endpoint, and I did
    not invent one. The CTA goes to `/register`. When a real billing
    integration lands, this page becomes a thin client component.

  - **Pricing tier "Pro advanced skills"** — the comparison table
    advertises PPT-master / scientific-illustrator / ARIS as
    early-access. Those repos are not in the bundled catalog (could
    not verify them in this round). They are honest about being
    aspirational.

  - **Marketing screenshots / video** — every feature card is
    text-only. Real screenshots from the workspace would help.
    Recording them requires the user to run an end-to-end demo
    with real data, which I can't fabricate.

  - **Crawler-friendly copy** — the meta description on
    `app/layout.tsx` is the default. OG tags, JSON-LD, and sitemap
    are not added. Trivial follow-up if marketing cares.

  - **i18n** — `apps/web/src/i18n/` exists (en + zh-CN). The
    marketing site is English-only. Copy to `messages/en.json` for
    the surface strings would be the next step.

## Run

The marketing site lives inside the existing Next.js app — same
`pnpm dev` / `pnpm start` as the workspace.

```bash
# build everything
pnpm --filter @agentx/api build
pnpm --filter @agentx/web build

# run the API for the live /skills catalog
node apps/api/dist/server.js          # :8787

# run the web (with marketing + workspace) — defaults to /
pnpm --filter @agentx/web start  # :3000
```

If you only want the marketing chrome without the API running,
`/skills` falls back to a hard-coded list of the 13 bundled skills
with a status line that tells the visitor the API is offline.

## Style notes for the next person

  - All pages are server components — no `use client` at the page
    level, no client-only bundle in the marketing chrome. This keeps
    the public surface snappy on first paint and crawlable.

  - All colors / typography come from `globals.css` CSS variables.
    The marketing CSS adds no new colors, only layout.

  - The catalog pointer on the home page is a server-side
    `fetch(..., { cache: "no-store" })` against
    `/api/v1/skill-marketplace/catalog` (path is correct as of this
    commit; if you rename it in the API, fix both this fetch and
    the `/skills` page fetch).

  - The `Hallmark` skill is a real open-source project at
    `Nutlope/hallmark`. The word is also a famous greeting-card
    trademark. The catalog description acknowledges this; the
    marketing site never uses the word in user-facing copy other
    than the catalog card.

## Commit history

  e6f3cf3  feat(skills): add 4 verified design / marketing skills to default catalog
  ac86caa  feat(web): marketing landing (replaces /data-tasks auto-redirect)
  4333635  feat(web): /features — long-form product deep-dive
  9454335  feat(web): /pricing — three-tier matrix + feature comparison
  7d50d8e  feat(web): /skills — public catalog browse with live fetch + fallback
  c0e209b  feat(web): /docs — public getting-started + source map