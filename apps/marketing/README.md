# apps/marketing

Standalone Next.js 15.5 project for the public DataFoundry marketing site.
Built with `output: "export"` so it produces a static bundle that
[`.github/workflows/pages.yml`](../../.github/workflows/pages.yml) uploads to
GitHub Pages at `https://sjkncs.github.io/agentx/`.

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

Next.js 15 doesn't honour `basePath` for `output: "export"` (the static HTML
keeps the un-prefixed `/features` hrefs even when you set `basePath`).
Instead, `pages.yml` copies the build output into an `/agentx/` subdirectory
manually:

```
.artifact/agentx/
├── index.html
├── docs.html              → /agentx/docs
├── features.html          → /agentx/features
├── pricing.html           → /agentx/pricing
├── skills.html            → /agentx/skills
├── 404.html
├── _next/
│   └── static/...         → /agentx/_next/static/...
├── brand/ax-favicon.svg   → /agentx/brand/ax-favicon.svg
```

All internal Next.js generated links (`/_next/static/chunks/...`) and
`<Link href="/features">` resolve naturally at the Pages URL.

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

The pages.yml workflow builds and uploads this project automatically on
push to `main` whenever any of the following change:

- `apps/marketing/**`
- `apps/web/src/app/(marketing)/**`
- `package.json` / `package-lock.json`
- `.github/workflows/pages.yml`

To trigger a manual deploy: Actions → "Deploy marketing site to GitHub
Pages" → Run workflow.

## Sync with apps/web

When `apps/web/src/app/(marketing)/**` changes, mirror the same change
here. Keep the styles, copy, and skill catalog in lockstep — both
projects must agree on the public surface. The CI build of `apps/web` is
the source of truth for content; `apps/marketing` is a downstream fork.
