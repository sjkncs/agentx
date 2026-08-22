#!/usr/bin/env node
// scripts/check-no-bundled-presets.mjs
// CI grep gate — fail if the desktop / web source tree ships bundled persona
// presets for trademarked / copyrighted / celebrity characters.
//
// A32 desk-pet spec §7.1 forbids shipping presets for Vocaloid / anime /
// public-figure personas. Users can author their own, but the codebase must
// not bake them in. This gate scans source-only paths so docs / README can
// mention the policy without tripping it.
//
// Add a name to the BLOCKED list when (a) it's a known copyrighted character,
// (b) the user community might mistake a built-in pet for the official IP, or
// (c) we don't have permission to redistribute the persona text.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const BLOCKED_PATTERNS = [
  // CJK
  /洛天依/,
  // Vocaloid brand family
  /vocaloid/i,
  /hatsune/i,
  /miku/i,
  // Kagamine twins (handled together since one is rarely used without the other)
  /kagamine/i,
  // Re:Zero
  /\banya\b/i,
  /re:zero/i,
  // Touhou
  /\btouhou\b/i,
  // HoYoverse
  /\bgenshin\b/i,
  /原神/,
  // Arknights
  /arknights/i,
  /明日方舟/,
  // Blue Archive
  /blue.?archive/i,
  /蔚蓝档案/,
  // Star Rail
  /star.?rail/i,
];

const SEARCH_ROOTS = [
  "apps/desktop/src",
  "apps/web/src",
  "packages",
];

const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  "__tests__",
  "tests",
  "evaluate",        // services/datalink/evaluate holds third-party eval fixtures
  "results",         // services/datalink/evaluate/.../results holds run traces
  "fixtures",
  "test-data",
  "test_data",
]);

const SCAN_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mjs", ".js", ".cjs", ".json"
]);

const EXCLUDED_FILE_NAMES = new Set([
  "check-no-bundled-presets.mjs",
]);

/** Walk `root` recursively; yield `path` of each matching file. */
function* walkSource(rootAbs) {
  const stack = [rootAbs];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        const dot = entry.name.lastIndexOf(".");
        const ext = dot >= 0 ? entry.name.slice(dot) : "";
        if (!SCAN_EXTENSIONS.has(ext)) continue;
        if (EXCLUDED_FILE_NAMES.has(entry.name)) continue;
        yield full;
      }
    }
  }
}

const matches = [];

for (const root of SEARCH_ROOTS) {
  const rootAbs = join(REPO_ROOT, root);
  try {
    statSync(rootAbs);
  } catch {
    continue; // missing root — silently skip
  }
  for (const file of walkSource(rootAbs)) {
    let body;
    try {
      body = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const pattern of BLOCKED_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
      let m;
      while ((m = re.exec(body)) !== null) {
        const before = body.lastIndexOf("\n", m.index) + 1;
        const after = body.indexOf("\n", m.index);
        const lineEnd = after === -1 ? body.length : after;
        const lineStart = before === 0 ? 0 : before;
        const line = body.slice(lineStart, lineEnd);
        const lineNumber = body.slice(0, m.index).split("\n").length;
        matches.push({
          file: relative(REPO_ROOT, file).split(sep).join("/"),
          line: lineNumber,
          match: m[0],
          lineText: line.trim().slice(0, 160),
        });
        // Avoid infinite loop on zero-width matches.
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }
  }
}

if (matches.length > 0) {
  console.error("[check-no-bundled-presets] FAIL — bundled preset keyword(s) found:");
  for (const m of matches) {
    console.error(`  ${m.file}:${m.line}  [${m.match}]  ${m.lineText}`);
  }
  console.error("");
  console.error("Bundled personas for trademarked / copyrighted characters are forbidden");
  console.error("by apps/desktop/docs/PET_DESKTOP_SPEC.md §7.1. If you really need");
  console.error("this match, document why in the spec and add it to BLOCKED_PATTERNS");
  console.error("allow-list or rename the source file to match EXCLUDED_FILE_NAMES.");
  process.exit(1);
}

console.log("[check-no-bundled-presets] OK — no bundled preset keywords in source tree");
process.exit(0);