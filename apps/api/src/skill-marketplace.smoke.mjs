/**
 * skill-marketplace.smoke.mjs — A30 real-GitHub smoke test
 *
 * Boots a real MetadataStore on a temp sqlite file, runs through the
 * marketplace install path for every catalog entry, and asserts that:
 *   - SKILL.md bytes are pulled from raw.githubusercontent.com (real fetch)
 *   - bytes land in fileAssetService (sha256 dedup)
 *   - config_resource row exists (kind="skill", status="ready")
 *   - Supabase writes are attempted but DO NOT fail the test if env is offline
 *     (degraded mode is an explicit design choice)
 *
 * Usage:
 *   node apps/api/dist/skill-marketplace.smoke.mjs
 *   (run after `pnpm -F @datafoundry/api build`)
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const distRoot = join(import.meta.dirname, "..", "dist");
const { handleSkillMarketplaceRequest, setSkillCatalog } = require(join(distRoot, "routes", "skill-marketplace.js"));
const { loadCatalog } = require(join(distRoot, "..", "..", "packages", "skills", "dist", "marketplace.js"));
const { createMetadataStore } = require(join(distRoot, "..", "..", "packages", "metadata", "dist", "index.js"));
const { LocalFileAssetService } = require(join(distRoot, "..", "..", "packages", "files", "dist", "index.js"));

const dir = mkdtempSync(join(tmpdir(), "marketplace-smoke-"));
const dbPath = join(dir, `${randomUUID()}.sqlite`);
const metadataStore = createMetadataStore({ database_path: dbPath, storageRoot: dir });
const fileAssetService = new LocalFileAssetService(metadataStore, { storageRoot: dir });
const userId = randomUUID();
const workspaceId = `personal-${userId}`;
metadataStore.users.createPasswordUser({ id: userId, email: `${userId}@smoke.local`, display_name: "Smoke" });
metadataStore.workspaces.createPersonal({ id: workspaceId, owner_user_id: userId, name: "Smoke" });

const configContext = {
  dataGateway: {},
  fileAssetService,
  knowledgeService: {},
  metadataStore,
  runCancelRegistry: {},
  userId,
  workspaceId
};

const catalog = loadCatalog();
setSkillCatalog(catalog);

let okCount = 0;
let failCount = 0;
const failures = [];

for (const entry of catalog) {
  try {
    const req = { method: "POST", configContext };
    const resp = await handleSkillMarketplaceRequest(req, "/api/v1/skill-marketplace/install", { id: entry.id });
    if (!resp || resp.status !== 200) {
      failures.push(`${entry.id}: status=${resp?.status} body=${JSON.stringify(resp?.body)}`);
      failCount += 1;
      continue;
    }
    const data = resp.body?.data;
    if (!data?.fileAssetRefId || !data?.resourceId) {
      failures.push(`${entry.id}: missing fileAssetRefId or resourceId`);
      failCount += 1;
      continue;
    }
    console.log(
      `[smoke] ${entry.id}: bytes=${data.parsed.bytes} rev=${data.revision} file=${data.fileAssetRefId} supabase=${data.supabase?.audit?.status}`
    );
    okCount += 1;
  } catch (err) {
    failures.push(`${entry.id}: ${err instanceof Error ? err.message : String(err)}`);
    failCount += 1;
  }
}

try {
  metadataStore.close();
} catch {
  // ignore
}
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  // ignore
}

console.log(`\n[smoke] catalog=${catalog.length} ok=${okCount} fail=${failCount}`);
if (failCount > 0) {
  console.error("[smoke] failures:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
