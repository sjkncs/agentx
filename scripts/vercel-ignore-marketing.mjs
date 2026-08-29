#!/usr/bin/env node
// Vercel ignore command for the apps/marketing project — only build when the
// marketing site (or its upstream sources) changes. Mirrors scripts/vercel-ignore.mjs.
import { execSync } from "node:child_process";

const previousCommit = process.env.VERCEL_GIT_PREVIOUS_COMMIT;
const commit = process.env.VERCEL_GIT_COMMIT;

if (!previousCommit || !commit) {
  console.log("No commit info — building.");
  process.exit(1);
}

let diffOutput;
try {
  diffOutput = execSync(
    `git diff --name-only ${previousCommit} ${commit}`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  );
} catch {
  console.log("git diff failed — building.");
  process.exit(1);
}

const changed = diffOutput.split("\n").filter(Boolean);
const relevant = changed.some((path) =>
  path.startsWith("apps/marketing/") ||
  path.startsWith("apps/web/src/app/(marketing)/") ||
  path === "package.json" ||
  path === "package-lock.json"
);

if (relevant) {
  console.log(`Relevant changes (${changed.length} files) — building.`);
  process.exit(1);
}

console.log(`No marketing-related changes (${changed.length} files) — skipping build.`);
process.exit(0);
