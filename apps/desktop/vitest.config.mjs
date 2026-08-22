// apps/desktop/vitest.config.mjs
// Run with: npx vitest run
//
// We do not pull in any tsconfig here — the persona module is plain ESM
// JavaScript. Vitest resolves Zod (and any other dependency declared in
// apps/desktop/package.json `dependencies`) via Node module resolution.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.mjs"],
    reporters: ["default"],
  },
});