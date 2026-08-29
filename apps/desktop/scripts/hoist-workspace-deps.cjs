// Build-time helper: hoist @agentx/* + better-sqlite3 + bindings from
// the workspace root's node_modules into apps/desktop/node_modules as real
// directories (npm workspaces installs workspace packages as symlinks, which
// breaks electron-builder's unpack logic).
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SOURCE_ROOT = path.join(ROOT, "node_modules");
const TARGET_ROOT = path.join(ROOT, "apps", "desktop", "node_modules");

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isSymbolicLink()) {
      // Resolve the symlink target and copy the real contents.
      const target = fs.readlinkSync(srcPath);
      const absolute = path.isAbsolute(target) ? target : path.resolve(path.dirname(srcPath), target);
      if (!fs.existsSync(absolute)) {
        console.warn(`skip dangling symlink: ${srcPath} -> ${target}`);
        continue;
      }
      const stat = fs.statSync(absolute);
      if (stat.isDirectory()) {
        copyDirSync(absolute, dstPath);
      } else if (stat.isFile()) {
        fs.copyFileSync(absolute, dstPath);
      }
    } else if (entry.isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

const targets = [
  path.join(SOURCE_ROOT, "@agentx"),
  path.join(SOURCE_ROOT, "better-sqlite3"),
  path.join(SOURCE_ROOT, "bindings"),
  path.join(SOURCE_ROOT, "file-uri-to-path"),
];

for (const src of targets) {
  if (!fs.existsSync(src)) {
    console.warn(`source missing: ${src}`);
    continue;
  }
  const dst = path.join(TARGET_ROOT, path.relative(SOURCE_ROOT, src));
  console.log(`copy ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dst)}`);
  copyDirSync(src, dst);
}
console.log("done");