const { readFileSync, writeFileSync } = require("node:fs");

// Read README as raw bytes and detect encoding issues
const buf = readFileSync("README.md");
console.log("File size:", buf.length);
console.log("First 50 bytes:", buf.subarray(0, 50).toString("hex"));

// Try to decode as UTF-8 and re-encode cleanly
let content;
try {
  content = buf.toString("utf8");
} catch (e) {
  console.error("UTF-8 decode failed, trying latin1:", e.message);
  content = buf.toString("latin1");
}

// Check for problematic patterns
const problematicPatterns = [
  { pattern: /â€[—–""]/g, replacement: "—" },
  { pattern: /\uFFFD/g, replacement: "" },
  { pattern: /�/g, replacement: "" }
];

let fixedContent = content;
for (const { pattern, replacement } of problematicPatterns) {
  const before = fixedContent.length;
  fixedContent = fixedContent.replace(pattern, replacement);
  const after = fixedContent.length;
  if (before !== after) {
    console.log(`Fixed ${before - after} occurrences of ${pattern}`);
  }
}

// Write the fixed file with UTF-8 BOM stripped
const output = Buffer.from(fixedContent, "utf8");
writeFileSync("README.md.fixed", output);

console.log("Fixed file written. New size:", output.length);
console.log("First 50 bytes of fixed:", output.subarray(0, 50).toString("hex"));