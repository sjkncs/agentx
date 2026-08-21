# A29 — Skill Marketplace + Vertical Pipeline

## Background

Two follow-ups from the A28 commit:

1. **Vertical pipeline stepper.** The current `ProtocolPhaseStepper` is a
   horizontal scroll strip above the chat input (image: A29_pipeline_horizontal.png).
   With more than 4 phases it scrolls offscreen, the active phase guidance gets
   pushed into a single line-clamp-2 paragraph, and the "needs your input"
   badge crowds the right edge. Switching to a vertical stack keeps every
   phase label + guidance visible regardless of phase count.

2. **Skill marketplace / installer.** Skills today only land in a workspace
   via uploaded SKILL.md / .zip on `POST /api/v1/skills`. The user wants a
   curated catalog of GitHub-hosted open-source skills (ppt-master,
   scientific-illustrator, hallmark, impeccable, taste-skill, page-agent,
   ARIS, scroll-world, …) that can be installed with one click. The
   marketplace reuses the existing config-resource skill pipeline so
   installed skills go through the same audit / materialize / governance
   path as uploaded ones — no new runtime hot path.

## In-scope

### A29.1 Vertical pipeline stepper
- Rewrite `apps/web/src/app/data-tasks/components/chat/protocol-phase-stepper.tsx`
  to render each phase as a row in a vertical stack: status dot on the
  left, label + guidance to the right, with a 2px vertical connector line
  between rows. Active phase gets a soft bg-primary-light/15 highlight.
- Width: same container width as the chat input (so it still anchors to
  the input but no longer overflows horizontally).
- Accessibility: each row is `role="listitem"` inside `role="list"`,
  active row has `aria-current="step"`.
- Keep all existing i18n keys (`protocolPhase.*`).

### A29.2 Skill marketplace backend
- New file `apps/api/src/routes/skill-marketplace.ts`
  - `GET  /api/v1/skill-marketplace/catalog`
    Returns the curated catalog. Catalog JSON lives in
    `packages/skills/builtin/skill-catalog.json` (committed in this PR,
    see "Catalog seed" below).
  - `POST /api/v1/skill-marketplace/install`
    Body: `{ repo: "owner/name", ref?: "main", skillPath?: "SKILL.md" }`
    Flow:
      1. Validate the repo is in the allow-list (defense-in-depth — we only
         proxy the curated repos so a malicious payload can't pivot).
      2. Fetch `https://raw.githubusercontent.com/<repo>/<ref>/<skillPath>`.
      3. Pass the body through `parseSkillPackage` (existing parser — it
         handles frontmatter + allowed-tools validation).
      4. Persist via the same upload path as `skillUploadBody`, except
         the bytes come from the network instead of `request`.
      5. Return the new `SkillRecord` JSON, same shape as
         `GET /api/v1/skills/:id`.
- New file `packages/skills/src/marketplace.ts`
  - `SkillCatalogEntry`, `loadCatalog(path?)` exported type/functions so
    tests can pass an in-memory catalog.
  - The catalog JSON has `repo`, `displayName`, `description`, `tags`,
    `category`, `skillPath`, `defaultRef`, `homepage`, `license`.

### A29.3 Marketplace frontend
- New page `apps/web/src/app/admin/skill-marketplace/page.tsx`
  - Lists the catalog with a search box + category filter
  - "Install" button → calls `/api/v1/skill-marketplace/install`, shows
    loading state, then refreshes the workspace skills list
  - Status chip per row: not-installed / installing / installed / error
- New component `apps/web/src/app/data-tasks/components/task-console/SkillMarketPanel.tsx`
  Add a "Browse marketplace" button next to the existing skill list
  that routes to the new page.
- Add nav link in `apps/web/src/app/admin/_nav.tsx` (or wherever admin
  links live).

### A29.4 Catalog seed (committed JSON)
`packages/skills/builtin/skill-catalog.json` with the user-requested
entries. Each entry is metadata only — the actual SKILL.md is fetched
from GitHub at install time so we never ship out-of-date binaries.

```jsonc
[
  {
    "id": "ppt-master",
    "displayName": "ppt-master",
    "description": "PowerPoint deck builder …",
    "category": "documents",
    "tags": ["ppt", "presentation", "deck"],
    "repo": "<owner>/ppt-master",
    "defaultRef": "main",
    "skillPath": "SKILL.md",
    "homepage": "https://github.com/<owner>/ppt-master",
    "license": "MIT"
  },
  { "id": "scientific-illustrator", … },
  { "id": "hallmark", … },
  { "id": "impeccable", … },
  { "id": "taste-skill", … },
  { "id": "page-agent", … },
  { "id": "aris", … },
  { "id": "scroll-world", … }
]
```

Repos left as `<owner>/<name>` placeholders. The marketplace endpoint
refuses to install anything not in the catalog, so placeholders are safe
until they are filled in.

## Out of scope
- Auto-update / version bumping of installed skills
- Private GitHub repos (no token support in this PR)
- Zip-based GitHub releases (only single-file SKILL.md fetches)
- Pulling down other files referenced by SKILL.md (the parser already
  supports zip packages for that, but the marketplace only handles
  single-file SKILL.md for v1)

## Acceptance criteria
| Criterion | Machine gate |
|-----------|--------------|
| Vertical stepper renders N phases without horizontal scroll | `data-testid="protocol-phase-stepper"` has `flex-col` not `overflow-x-auto` |
| Stepper retains all i18n keys | `apps/web` `tsc --noEmit` |
| Catalog endpoint returns ≥6 entries | `curl /api/v1/skill-marketplace/catalog` JSON has items.length ≥ 6 |
| Install endpoint refuses unknown repo | `curl /api/v1/skill-marketplace/install` with repo not in catalog → 400 `REPO_NOT_ALLOWED` |
| Install happy path persists a skill record | after install, `GET /api/v1/skills` contains the new id (depends on GitHub being reachable from the dev machine; CI uses a stub) |
| Marketplace page mounts without console errors | `tsc --noEmit` |

## Files touched
- `apps/web/src/app/data-tasks/components/chat/protocol-phase-stepper.tsx` (rewritten layout)
- `apps/web/src/app/admin/skill-marketplace/page.tsx` (new)
- `apps/web/src/app/data-tasks/components/task-console/SkillMarketPanel.tsx` (add browse button)
- `apps/api/src/routes/skill-marketplace.ts` (new)
- `apps/api/src/server.ts` (mount route — before config router)
- `packages/skills/src/marketplace.ts` (new — catalog loader)
- `packages/skills/src/index.ts` (re-export marketplace helpers)
- `packages/skills/builtin/skill-catalog.json` (new — committed seed)
- `apps/web/src/app/admin/_nav.tsx` (link)

## Risks
1. GitHub rate-limit (60 req/h unauthenticated). Mitigated by only
   proxying the catalog entries we trust, and the marketplace UI only
   installs on explicit user click (not at startup).
2. SKILL.md schemas vary wildly between communities. The existing
   `parseSkillPackage` already requires `name` + `description` +
   frontmatter — entries that fail validation surface as
   `SKILL_PARSE_FAILED` to the UI; we don't silently swallow errors.