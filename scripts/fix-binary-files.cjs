const { execSync } = require("node:child_process");
const { readFileSync, statSync } = require("node:fs");
const { join } = require("node:path");

function isBinaryContent(buf) {
  // Heuristic: more than 10% non-text bytes suggests binary
  let nonText = 0;
  const sample = buf.subarray(0, Math.min(buf.length, 5000));
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b >= 0x20 && b < 0x7f) continue;
    if (b >= 0xc0) continue; // UTF-8 multi-byte
    nonText++;
  }
  return nonText / sample.length > 0.1;
}

function getAllTsFiles() {
  const output = execSync('git ls-files "apps/web/src/**/*.ts*"', { encoding: "utf8" });
  return output.trim().split("\n");
}

const files = getAllTsFiles();
console.log(`Checking ${files.length} TypeScript files for binary content...`);

const brokenFiles = [];
for (const file of files) {
  try {
    const buf = readFileSync(file);
    if (isBinaryContent(buf)) {
      brokenFiles.push(file);
      console.log(`[BROKEN] ${file} (${buf.length} bytes)`);
    }
  } catch (err) {
    console.error(`[ERROR] ${file}: ${err.message}`);
  }
}

console.log(`\nFound ${brokenFiles.length} broken files:`);
for (const f of brokenFiles) console.log(`  - ${f}`);

if (brokenFiles.length > 0) {
  console.log("\nRestoring from git...");
  try {
    const fileList = brokenFiles.map(f => `"${f}"`).join(" ");
    execSync(`git checkout HEAD -- ${fileList}`, { stdio: "inherit" });
    console.log("Restore complete.");
  } catch (err) {
    console.error("Restore failed:", err.message);
  }
}