import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "node:fs": "fs",
      "node:path": "path",
      "node:http": "http",
      "node:url": "url",
      "node:buffer": "buffer",
      "node:child_process": "child_process",
    },
  },
});
