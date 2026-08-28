import type { NextConfig } from "next";

// Standalone marketing site — no basePath. The pages.yml workflow
// reorganises the output into an /agentx/ artifact directory so
// the bundle serves at https://sjkncs.github.io/agentx/.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
