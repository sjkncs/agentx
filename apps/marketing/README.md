# apps/marketing

Standalone Next.js 15.5 project for the public DataFoundry marketing site.
Built with `output: "export"` so it produces a static bundle deployed to
**Vercel** (primary, via [`vercel.json`](./vercel.json)) and **GitHub
Pages** (backup, via
[`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) →
`https://sjkncs.github.io/agentx/`).

This project is a **deliberately trimmed** fork of
[`apps/web/src/app/(marketing)`](../web/src/app/(marketing)). It exists because
the main `apps/web` Next.js app mixes marketing routes with runtime API
routes and dynamic admin pages, which Next.js 15.5 refuses to bundle under
`output: "export"`. Splitting the marketing pages into their own project
sidesteps that constraint.

## What's here

| Route | Source |
|---|---|
| `/` | `src/app/(marketing)/page.tsx` |
| `/features` | `src/app/(marketing)/features/page.tsx` |
| `/skills` | `src/app/(marketing)/skills/page.tsx` |
| `/pricing` | `src/app/(marketing)/pricing/page.tsx` |
| `/docs` | `src/app/(marketing)/docs/page.tsx` |

Shared chrome: `src/app/(marketing)/layout.tsx` + `src/app/marketing.module.css`.
Bundled skill catalog: `src/data/skill-catalog.ts`.

## Artifact layout for Pages

`pages.yml` builds with `AGENTX_PAGES=1`, which turns on
`basePath: "/agentx"` and `trailingSlash: true` in
[`next.config.ts`](./next.config.ts). `next/link` hrefs and the asset URLs
in the exported HTML both honour `basePath`, so everything is already
`/agentx`-prefixed; `trailingSlash` makes the export emit folder-style
pages, the layout GitHub Pages needs to serve trailing-slash URLs. The
finished site lands in `out/` and is uploaded as-is:

```
out/
├── index.html             → /agentx/
├── docs/index.html        → /agentx/docs/
├── features/index.html    → /agentx/features/
├── pricing/index.html     → /agentx/pricing/
├── skills/index.html      → /agentx/skills/
├── 404.html
├── _next/
│   └── static/...         → /agentx/_next/static/...
├── brand/ax-favicon.svg   → /agentx/brand/ax-favicon.svg
```

GitHub Pages serves the artifact root at `https://sjkncs.github.io/agentx/`,
so no reorganisation is needed. (The flat `features.html` you see under
`.next/server/app/` is an intermediate build artifact — the `out/` export
is the one that applies `trailingSlash`.)

## What's deliberately removed (vs. the live site)

- The live `apps/web/(marketing)/skills` page fetches
  `GET /api/v1/skill-marketplace/catalog` and falls back to a hard-coded
  list. This project uses the hard-coded list directly — there is no API
  runtime.
- The home page used `process.env.NEXT_PUBLIC_DATAFOUNDRY_API_BASE` for
  the same fetch. Replaced with a static 4-card spotlight filtered from
  `SKILL_CATALOG`.
- `/register` and `/login` CTAs are repointed to the GitHub repo
  (`https://github.com/sjkncs/agentx`). They have no working counterpart
  on the static site.
- The `globals.css` design tokens are copied over; CopilotKit-specific
  styles, workspace animations, and data-theme overrides are dropped.

## Local dev

```bash
npm --workspace @agentx/marketing run dev   # http://localhost:3001
```

## Deploy

Two targets run in parallel — **Vercel is primary**, **GitHub Pages is the
automatic backup**. Both build the same static export; they just differ in
URL prefixing (see "Artifact layout for Pages" above).

### Primary: Vercel

Driven by [`vercel.json`](./vercel.json). It builds with a clean
environment (no `AGENTX_PAGES`), so there is **no `/agentx` prefix** — the
site serves from the Vercel domain root, and Vercel's clean URLs serve
`features.html` at `/features`.

- `installCommand`: `npm install --engine-strict=false` — the monorepo
  `.npmrc` sets `engine-strict=true`, which fails on Vercel's Node; this
  bypasses it and also tolerates the out-of-sync lockfile.
- `outputDirectory`: `out` (the finished static export).
- `ignoreCommand`: skips builds when nothing marketing-related changed
  (`scripts/vercel-ignore-marketing.mjs`).

One-time setup (no repo secrets needed):

1. Go to <https://vercel.com/new> → import `sjkncs/agentx`.
2. **Root Directory:** `apps/marketing`. Framework auto-detects as Next.js;
   the `vercel.json` supplies install/build/output settings.
3. Deploy. You get `https://<project>.vercel.app`.

### Backup: GitHub Pages

The [`pages.yml`](../../.github/workflows/pages.yml) workflow builds and
uploads this project automatically on push to `main` whenever any of the
following change:

- `apps/marketing/**`
- `apps/web/src/app/(marketing)/**`
- `package.json` / `package-lock.json`
- `.github/workflows/pages.yml`

To trigger a manual deploy: Actions → "Deploy marketing site to GitHub
Pages" → Run workflow. Result: <https://sjkncs.github.io/agentx/>.

## Sync with apps/web

When `apps/web/src/app/(marketing)/**` changes, mirror the same change
here. Keep the styles, copy, and skill catalog in lockstep — both
projects must agree on the public surface. The CI build of `apps/web` is
the source of truth for content; `apps/marketing` is a downstream fork.
