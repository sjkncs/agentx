import type { NextConfig } from "next";

// GitHub Pages project sites serve at https://sjkncs.github.io/agentx/.
// When building for Pages (AGENTX_PAGES=1, set by .github/workflows/pages.yml),
// every href/asset URL needs the /agentx prefix. next/link and the asset
// URLs emitted into the exported HTML both honor basePath, so we let
// Next do the prefixing instead of rewriting files after the fact.
//
// trailingSlash: true makes the export emit folder-style pages
// (features/index.html), which is the layout GitHub Pages requires for
// trailing-slash URLs — /agentx/features/ would 404 against a flat
// features.html file.
const isPagesBuild = process.env.AGENTX_PAGES === "1";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  ...(isPagesBuild
    ? { basePath: "/agentx", trailingSlash: true }
    : {}),
};

export default nextConfig;
