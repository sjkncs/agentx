#!/usr/bin/env node
// Vercel ignore command — only build when something under apps/web or package manifests changes.
// Reads the changed file paths from $VERCEL_GIT_PREVIOUS_COMMIT ... $VERCEL_GIT_COMMIT.
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
  path.startsWith("apps/web/") ||
  path.startsWith("packages/") ||
  path.startsWith("scripts/") ||
  path === "package.json" ||
  path === "package-lock.json" ||
  path === "tsconfig.base.json" ||
  path === "tsconfig.build.json"
);

if (relevant) {
  console.log(`Relevant changes (${changed.length} files) — building.`);
  process.exit(1);
}

console.log(`No web-related changes (${changed.length} files) — skipping build.`);
process.exit(0);
