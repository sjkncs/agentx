import { defineConfig } from "vitest/config";

// apps/web has tsconfig.json with "jsx": "preserve" for Next.js.
// Vitest's esbuild will inherit that and leave JSX untransformed, which
// breaks `<Component />` literals in tests because there's no React in scope.
// Force vitest to use the automatic JSX runtime so tests can write JSX.
export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./test/setup.ts"],
  },
});