import path from "node:path";
import type { NextConfig } from "next";

const workspaceRoot = path.join(__dirname, "../..");

// GitHub Pages lives at https://<owner>.github.io/<repo>/. When deploying
// to a project Pages site (NOT the user-site / <owner>.github.io root),
// every Next.js link, asset, and Image src must be prefixed with the
// repo name. Set AGENTX_PAGES=1 at build time to opt in.
const isGitHubPages = process.env.AGENTX_PAGES === "1";
const pagesBasePath = "/agentx";

const nextConfig: NextConfig = {
  // Monorepo workspace packages (@agentx/*) are not pre-built during
  // Vercel CI (we skip postinstall's monorepo tsc -b to avoid pulling in
  // apps/api's harness-core chain). Next.js needs to transpile the TS
  // sources directly from packages/*/src.
  transpilePackages: [
    "@agentx/contracts",
  ],
  // Next's default `compress: true` applies gzip to `text/*`, including
  // `text/event-stream`. Even with flush hooks, compression is the wrong layer
  // for AG-UI SSE. Disable here; terminate TLS/gzip at the reverse proxy for
  // HTML/assets (see deploy/nginx.agentx.conf.example), and leave
  // `/api/copilotkit` uncompressed.
  compress: false,
  // GitHub Pages is a CDN with no runtime. basePath rewrites every internal
  // URL so /agentx/skills resolves to the right asset on Pages; assetPrefix
  // tells Next to also rewrite _next/* URLs (CSS/JS chunks) to the same prefix
  // so they are served from the Pages origin, not the dev origin.
  //
  // Note: this project intentionally uses `output: "standalone"` for the
  // Node API deploy path (see Dockerfile / deploy.sh). Pure static
  // `output: "export"` is NOT supported because:
  //   (a) /admin/workorders/[case_no] is a "use client" dynamic route —
  //       Next.js 15.5 still forbids the "use client" + generateStaticParams
  //       combo;
  //   (b) every /api/* route handler sets `dynamic = "force-dynamic"`,
  //       which Next refuses under `output: "export"` with
  //       "force-dynamic on page /api/... cannot be used with output: export";
  //   (c) the marketing routes fetch the live catalog with
  //       `cache: "no-store"`, so even if we forced them static the build
  //       would freeze an empty catalog snapshot.
  // If you need a GitHub Pages marketing-only deploy, fork the marketing
  // pages into a separate Next.js project with `output: "export"` and
  // host that — the current monorepo is built for the Node.js API path.
  ...(isGitHubPages
    ? {
        basePath: pagesBasePath,
        assetPrefix: pagesBasePath,
        images: { unoptimized: true },
      }
    : {}),
  // Production / test builds: tree-shake heavy package entrypoints.
  experimental: {
    optimizePackageImports: ["zod"],
  },
  // Dev uses Turbopack (see `dev` script). Declaring this key pins the
  // monorepo root and silences the "Webpack is configured while Turbopack is
  // not" warning; the webpack() hook below still applies to `next build`.
  turbopack: {
    root: workspaceRoot,
  },
  // Same-origin `/api/*` is owned by App Router route handlers
  // (`app/api/**/route.ts` → `proxyToApi`). Do not add rewrites for those
  // paths: rewrites cannot set SSE anti-buffering headers, and would race the
  // intentional streaming BFF.
  webpack(config, { isServer }) {
    if (isServer && config.output) {
      config.output.chunkFilename = "chunks/[name].js";
    }
    // Fix @/ alias resolution in monorepo root. Next.js infers this from
    // tsconfig.json's baseUrl, but the monorepo root is not the web package.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(__dirname, "src"),
    };
    return config;
  },
};

export default nextConfig;
