import type { NextConfig } from "next";

// Standalone marketing site.
//
// Why `basePath: "/agentx"` AND `trailingSlash: true`:
//   GitHub Pages hosts this project site at
//   https://sjkncs.github.io/agentx/  — so every internal link and
//   asset must carry the /agentx prefix. With output: "export",
//   `basePath` rewrites all <a href> and asset URLs in the generated
//   HTML to include /agentx, and `trailingSlash: true` makes GitHub
//   Pages resolve /features/ to features.html (Pages doesn't do
//   extension-less routing by default).
const nextConfig: NextConfig = {
  output: "export",
  basePath: "/agentx",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
