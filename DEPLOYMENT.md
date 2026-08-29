# AgentX — Minimal Viable Deployment Guide

> **TL;DR**: Frontend on Vercel · API on Fly.io · SQLite file on a persistent volume · Supabase (free) for pgvector + event log.
> **Time to first deploy**: ~30 minutes.

This guide assumes you already have accounts on:
- [Vercel](https://vercel.com) (free tier works)
- [Fly.io](https://fly.io) (free tier includes 1 GB persistent volume)
- [Supabase](https://supabase.com) (free tier is enough for early production)

It will get you to a working public URL where all UI, API, and buttons function.

---

## 1. Architecture (what runs where)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Browser                                    │
│                       https://<your-domain>                             │
└─────────────────────────────────────────────────────────────────────────┘
              │                                            │
              ▼                                            ▼
┌──────────────────────────────┐         ┌────────────────────────────────┐
│  Vercel (Web)                │  HTTPS  │  Fly.io (API)                  │
│  - Next.js 15 + CopilotKit   │ ──────▶ │  - Node.js 22 + Express-y HTTP │
│  - Static + Edge Runtime     │         │  - AG-UI event stream (SSE)    │
│  - /api/copilotkit → proxy  │         │  - Local SQLite (570 MB quota) │
└──────────────────────────────┘         │  - Persistent volume /data     │
                                         └─────────────┬──────────────────┘
                                                       │
                                       ┌───────────────┴───────────────┐
                                       ▼                               ▼
                       ┌─────────────────────────┐   ┌─────────────────────────┐
                       │ Supabase (optional)     │   │ Fly persistent volume   │
                       │ - pgvector memory index │   │ ~/data/                  │
                       │ - event log mirror      │   │ - metadata.sqlite        │
                       │ - realtime approvals    │   │ - files/                 │
                       │   (free tier, 500 MB)   │   │ - mastra/agent-state.sqlite │
                       └─────────────────────────┘   └─────────────────────────┘
```

---

## 2. Domain strategy

You have **one** requirement: a stable domain. Choose one of these:

| Approach | Setup | Cost |
|----------|-------|------|
| **Vercel subdomain only** | `https://agentx-<your-name>.vercel.app` for web + `https://agentx-<your-name>.fly.dev` for API (CORS works because Vercel supports any Origin with the right header) | **$0** |
| **Custom domain** | Buy `agentx.dev` on Cloudflare Registrar, point `app.` to Vercel, `api.` to Fly.io | ~$10/yr |

**Recommendation**: start with the free `*.vercel.app` + `*.fly.dev` pair. Both are HTTPS by default, no CORS trouble.

---

## 3. Step-by-step (do these in order)

### Step 1 — Supabase setup (10 min)

1. Create a new project at <https://supabase.com/dashboard> (pick the region closest to your API host).
2. Open **SQL Editor** → New query → paste the contents of
   [`packages/supabase-bridge/sql/001_init.sql`](packages/supabase-bridge/sql/001_init.sql) → Run.
3. New query → paste the contents of
   [`packages/supabase-bridge/sql/002_memory_functions.sql`](packages/supabase-bridge/sql/002_memory_functions.sql) → Run.
4. **Project Settings → API** → copy:
   - `URL` → `SUPABASE_URL`
   - `service_role` (secret) → `SUPABASE_SERVICE_KEY`
   - `anon` public → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Save them somewhere — you'll paste them in Vercel and Fly later.

### Step 2 — Fly.io API (10 min)

```bash
# One-time
brew install flyctl        # or scoop install flyctl on Windows
fly auth signup

# Per project
cd agentx-enhanced
fly launch --no-deploy --copy-config --name df-api-<your-name>
#   When prompted: choose a region close to your Supabase project.
#   Say NO to "Do you want to deploy now?" — we'll set secrets first.

# Create the persistent volume (1 GB is plenty for early usage)
fly volumes create df_data --size 1 --region <region>

# Generate session secrets
export AUTH_SECRET=$(openssl rand -hex 32)
export COOKIE_DOMAIN=".fly.dev"

# Set API secrets (REQUIRED — paste your real keys)
fly secrets set \
  AUTH_SECRET=$AUTH_SECRET \
  COOKIE_DOMAIN=$COOKIE_DOMAIN \
  MASTRA_OPENAI_API_KEY=sk-... \
  EMBEDDING_API_KEY=sk-... \
  SUPABASE_URL=https://xxx.supabase.co \
  SUPABASE_SERVICE_KEY=eyJh... \
  CORS_ALLOWED_ORIGINS="https://agentx-<your-name>.vercel.app"

# Deploy
fly deploy -c fly.api.toml
```

Wait for the URL `https://df-api-<your-name>.fly.dev`. Test it:

```bash
curl https://df-api-<your-name>.fly.dev/api/v1/capabilities
# Should return JSON, not 502.
```

### Step 3 — Vercel Web (5 min)

1. Push this repo to GitHub (if you haven't already).
2. Open <https://vercel.com/new> → import the repo.
3. **Override these settings**:
   - **Project name**: `agentx-<your-name>`
   - **Root directory**: `apps/web`
   - **Framework preset**: Next.js (auto-detected)
4. Add **Environment Variables** for the **Production** environment:

   | Key | Value |
   |-----|-------|
   | `NEXT_PUBLIC_CONFIG_API_URL` | `https://df-api-<your-name>.fly.dev` |
   | `NEXT_PUBLIC_AGENT_RUNTIME_URL` | `https://df-api-<your-name>.fly.dev/api/copilotkit` |
   | `NEXT_PUBLIC_SUPABASE_URL` | (your Supabase URL) |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (your Supabase anon key) |

5. Click **Deploy**. First build takes 3-5 minutes (workspace install + Next.js build).
6. Open the URL Vercel gives you (e.g. `https://agentx-<your-name>.vercel.app`).

### Step 4 — Verify end-to-end (5 min)

Walk through this checklist — every item must pass:

1. **Landing page** loads and shows the login/register screen.
2. **Register** a new user → confirmation/success.
3. **Login** → redirected to the data workspace.
4. **Click "New session"** → chat panel appears.
5. **Type a message and send** → AG-UI event stream flows (you'll see streaming tokens).
6. **Wait for response** → run completes, shows in the trace panel.
7. **Click "Run a skill"** → workflow executes.
8. **Check admin panel** at `/admin` → metrics show 1 run, status "completed".
9. **Upload a file** → appears in workspace files.
10. **Open Supabase dashboard → Table Editor → dfd_runs** → your run row is visible (proves event fan-out works).

If all 10 pass, your deployment is fully functional.

---

## 4. Custom domain (optional)

If you bought `agentx.dev` on Cloudflare:

1. **Vercel** → Project → Settings → Domains → add `app.agentx.dev`. Vercel will give you a CNAME; add it to Cloudflare DNS (orange-cloud off, proxy off).
2. **Fly.io** → `fly certs add api.agentx.dev` → follow the ACME DNS-01 instructions.
3. Update `CORS_ALLOWED_ORIGINS` on Fly to include `https://app.agentx.dev`.
4. Update Vercel env vars to point at `https://api.agentx.dev`.

---

## 5. Operating notes

### Where the data lives (what to back up)

```
Fly.io persistent volume /data/
├── metadata/workbench.sqlite       # users, sessions, approvals, configs
├── files/                          # uploaded files / artifacts
└── mastra/agent-state.sqlite       # agent memory + checkpoints
```

**Backup**: from your local machine,

```bash
fly ssh ssh sftp
# or use fly ssh console to run a sqlite3 dump
```

The volume is on a single Fly machine. For HA, you'd add a managed Postgres (see "Going to production" below).

### What uses Supabase vs local SQLite

| Subsystem | Storage | Why |
|-----------|---------|-----|
| Users, sessions, runs, approvals, audit | **Local SQLite** | Must be transactional with the API |
| File uploads, artifacts | **Local volume** | Large blobs, needs filesystem |
| Agent memory (long-term) | **Supabase pgvector** | Vector search, retrievable by web admin |
| Session event log | **Both** — SQLite primary, Supabase mirror | Realtime dashboards |

### Logs and debugging

- **Fly logs**: `fly logs -a df-api-<your-name>`
- **Vercel logs**: Vercel dashboard → Logs tab
- **Supabase logs**: dashboard → Logs → Postgres / API

### Capacity limits (free tier)

- **Vercel**: 100 GB bandwidth, 100 serverless invocations/day (more than enough)
- **Fly free**: 1 shared VM, 1 GB persistent volume, 160 GB outbound
- **Supabase free**: 500 MB database, 1 GB storage, 2 GB egress

You'll outgrow the free Supabase tier only after ~5,000 sessions or ~50k memories.

---

## 6. Going to production (when you outgrow free tier)

Switch the API storage to managed Postgres:

1. Provision a Postgres (Supabase, Neon, or RDS).
2. Add a `DATABASE_URL` env var.
3. Migrate the `metadata` package from `better-sqlite3` to `pg` (the schema is already compatible — see `packages/metadata/src/index.ts`).

Switch API host to a container platform with autoscaling:

- **Render** (`render.api.yaml` ships with this repo) — easiest, $7/mo for 1 GB.
- **Fly.io** autoscaling — replace `min_machines_running = 1` with auto-scaling in `fly.api.toml`.
- **AWS Fargate** — most flexible, ~$30/mo baseline.

Switch the frontend to a CDN-fronted origin:

- Cloudflare in front of Vercel (free) — gives global edge caching.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Vercel build fails: "Cannot find module @agentx/..." | Workspace install order | The `installCommand` in `apps/web/vercel.json` already handles this. If you still see it, run `npm install` locally and commit `package-lock.json`. |
| Login fails with CORS error | `CORS_ALLOWED_ORIGINS` not set on API | `fly secrets set CORS_ALLOWED_ORIGINS="https://<your-vercel-domain>"` |
| Agent run never finishes | SSE buffered by a proxy | The API sets `X-Accel-Buffering: no` on `/api/copilotkit`. If behind Cloudflare, enable "WebSockets" in the proxy. |
| Memory search returns nothing | pgvector mismatch | Ensure the `EMBEDDING_MODEL` in `.env` matches the dimension in `001_init.sql` (default 1024). If you switched to `text-embedding-3-small` (1536-d), update the column. |
| Health check fails on Fly | API listening on wrong port | Check `PORT` env matches `internal_port` in `fly.api.toml` (both 8787). |
| `npm install` fails with EBADENGINE on macOS | Node 22.21 has a known issue with `posthog-node` | Use `nvm install 22.22.0` and re-run. |

---

## 8. Cost summary (lowest realistic)

| Item | Free? | When it stops being free |
|------|-------|--------------------------|
| Vercel | ✅ Yes | After 100 GB bandwidth/mo |
| Fly.io (1 shared VM, 1 GB volume) | ✅ Yes | Their free tier was retired in 2024; cheapest VM is ~$1.94/mo |
| Supabase | ✅ Yes | After 500 MB database |
| OpenAI API | ❌ Pay-as-you-go | Embeddings ~$0.02/1M tokens, GPT-4o-mini ~$0.15/1M input |
| **Total** | **~$0–5/mo** | **Excluding LLM tokens** |

---

## 9. Files in this repo for deployment

| File | Purpose |
|------|---------|
| `apps/web/vercel.json` | Vercel config (root install, monorepo build, ignore patterns) |
| `Dockerfile.api` | Multi-stage Node.js build for the API |
| `.dockerignore` | Excludes docs, fixtures, .env, .cursor from image |
| `fly.api.toml` | Fly.io manifest (1 GB volume, 1 machine, health check) |
| `render.api.yaml` | Render manifest (alternative to Fly) |
| `packages/supabase-bridge/sql/001_init.sql` | Init schema (10 tables + RLS + pgvector index) |
| `packages/supabase-bridge/sql/002_memory_functions.sql` | RPCs for vector search |
| `.env.production.example` | All env vars with explanations |
| `scripts/vercel-ignore.mjs` | Skip Vercel builds when only non-web files changed |
