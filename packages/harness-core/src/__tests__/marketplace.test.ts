/**
 * Marketplace 单元测试 (offline / file:// 路径，避免网络抖动)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  Marketplace,
  createMarketplace,
  type PluginManifest,
} from "../index.js";

let cacheDir: string;
let fixtureDir: string;

beforeEach(async () => {
  cacheDir = join(tmpdir(), `mp-cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fixtureDir = join(tmpdir(), `mp-fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(fixtureDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(cacheDir, { recursive: true, force: true });
  await fs.rm(fixtureDir, { recursive: true, force: true });
});

async function writeRegistry(filename: string, items: PluginManifest[]) {
  const p = join(fixtureDir, filename);
  await fs.writeFile(p, JSON.stringify(items), "utf-8");
  return p;
}

describe("Marketplace", () => {
  it("lists cached fixtures and resolves by id", async () => {
    const registryPath = await writeRegistry("registry.json", [
      {
        id: "data-analyzer",
        name: "Data Analyzer",
        version: "1.0.0",
        capabilities: ["tool"],
        downloadUrl: "file:///dev/null",
        description: "Run SQL safely",
      },
    ]);
    const mp = createMarketplace({
      sources: [{ name: "local", url: `file://${registryPath}` }],
      cacheDir,
      fetchRetries: 0,
      fetchTimeoutMs: 1_000,
    });
    const all = await mp.refresh();
    expect(all.find((m) => m.id === "data-analyzer")).toBeDefined();
    expect(mp.find("data-analyzer")).toBeDefined();
  });

  it("search() supports fuzzy match", async () => {
    const registryPath = await writeRegistry("registry.json", [
      {
        id: "sql-runner",
        name: "SQL Runner",
        version: "1.0.0",
        capabilities: ["tool"],
        downloadUrl: "file:///dev/null",
        keywords: ["sql", "data"],
        description: "sql tool",
      },
      {
        id: "theme-dark",
        name: "Dark Theme",
        version: "1.0.0",
        capabilities: ["theme"],
        downloadUrl: "file:///dev/null",
      },
    ]);
    const mp = createMarketplace({
      sources: [{ name: "local", url: `file://${registryPath}` }],
      cacheDir,
      fetchRetries: 0,
      fetchTimeoutMs: 1_000,
    });
    await mp.refresh();
    expect(mp.search("sql").map((m) => m.id)).toContain("sql-runner");
    expect(mp.search("dark").map((m) => m.id)).toContain("theme-dark");
    expect(mp.search("nothing").length).toBe(0);
  });

  it("emits fetch:ok on success", async () => {
    const registryPath = await writeRegistry("registry.json", []);
    const mp = createMarketplace({
      sources: [{ name: "local", url: `file://${registryPath}` }],
      cacheDir,
      fetchRetries: 0,
      fetchTimeoutMs: 1_000,
    });
    let okCount = -1;
    mp.on("fetch:ok", (_src, count) => (okCount = count));
    await mp.refresh();
    expect(okCount).toBe(0);
  });

  it("install() requires prior refresh", async () => {
    const mp = createMarketplace({
      sources: [{ name: "empty", url: `file://${join(fixtureDir, "missing.json")}` }],
      cacheDir,
      fetchRetries: 0,
      fetchTimeoutMs: 1_000,
    });
    await expect(mp.install("does-not-exist")).rejects.toThrow();
  });
});
