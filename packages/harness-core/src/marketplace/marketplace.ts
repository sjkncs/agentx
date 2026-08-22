/**
 * Plugin / MCP Marketplace - 远程插件市场
 *
 * 设计目标：填补 ZCode 中"市场存在但网络/更新不便"的痛点。
 *   - 可配置的 remote registry URLs（多个 source）
 *   - 本地 file:// 缓存（避免网络抖动）
 *   - 内置 fetch with retry + backoff
 *   - 离线 fallback：联网失败时使用缓存
 *   - 安全：包大小/校验和展示，方便用户审查
 */

import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

// ============================================================================
// Types
// ============================================================================

export type PluginCapability = "tool" | "skill" | "theme" | "hook" | "runtime";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  homepage?: string;
  capabilities: PluginCapability[];
  /** 下载入口（zip / mjs） */
  downloadUrl: string;
  /** sha256 校验和（hex） */
  sha256?: string;
  /** 包大小（bytes），可由 registry 提供 */
  sizeBytes?: number;
  /** 最低引擎版本 */
  minEngineVersion?: string;
  /** 关键字 */
  keywords?: string[];
  /** 更新时间 */
  updatedAt?: string;
}

export interface RegistrySource {
  name: string;
  /** remote URL 或本地 file://path/to/registry.json */
  url: string;
  /** 用于离线备份 */
  fallbackCachePath?: string;
}

export interface MarketplaceConfig {
  sources: RegistrySource[];
  cacheDir: string;
  /** 单次 fetch 超时 */
  fetchTimeoutMs?: number;
  /** 重试次数 */
  fetchRetries?: number;
  /** 内置 fallback 源（默认含 zcode 智谱风格的样例 URL） */
  defaultSources?: RegistrySource[];
}

export interface InstalledPluginEntry {
  id: string;
  manifest: PluginManifest;
  /** 安装路径 */
  installPath: string;
  /** 是否启用 */
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
}

// ============================================================================
// Marketplace
// ============================================================================

export interface MarketplaceEvents {
  "fetch:start": [source: string];
  "fetch:ok": [source: string, count: number];
  "fetch:fail": [source: string, error: Error];
  "install:start": [id: string];
  "install:end": [entry: InstalledPluginEntry];
  "upgrade:end": [entry: InstalledPluginEntry, previousVersion: string];
}

export class Marketplace extends EventEmitter<MarketplaceEvents> {
  private readonly sources: RegistrySource[];
  private readonly cacheDir: string;
  private readonly fetchTimeoutMs: number;
  private readonly fetchRetries: number;
  private cacheIndex = new Map<string, PluginManifest>();
  private installed = new Map<string, InstalledPluginEntry>();

  constructor(config: MarketplaceConfig) {
    super();
    if (!config.sources || config.sources.length === 0) {
      throw new Error("Marketplace requires at least one source");
    }
    this.sources = [...config.defaultSources ?? [], ...config.sources];
    this.cacheDir = config.cacheDir;
    this.fetchTimeoutMs = config.fetchTimeoutMs ?? 8_000;
    this.fetchRetries = config.fetchRetries ?? 2;
  }

  // --------------------------------------------------------------------------
  // Discovery
  // --------------------------------------------------------------------------

  /** 从所有源拉取最新 registry，结果合并并写入磁盘缓存 */
  async refresh(): Promise<PluginManifest[]> {
    const results: PluginManifest[] = [];
    const errors: Error[] = [];

    await Promise.all(
      this.sources.map(async (source) => {
        try {
          const manifests = await this.fetchSource(source);
          results.push(...manifests);
          this.emit("fetch:ok", source.name, manifests.length);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          errors.push(error);
          this.emit("fetch:fail", source.name, error);
        }
      }),
    );

    // Try cache fallback for any source that failed
    if (errors.length > 0 && results.length === 0) {
      for (const source of this.sources) {
        if (source.fallbackCachePath) {
          try {
            const buf = await fs.readFile(source.fallbackCachePath, "utf-8");
            const cached = JSON.parse(buf) as PluginManifest[];
            results.push(...cached);
          } catch {
            // ignore
          }
        }
      }
    }

    // Persist to cacheDir/index.json
    await fs.mkdir(this.cacheDir, { recursive: true });
    const deduped = dedupeManifests(results);
    await fs.writeFile(
      path.join(this.cacheDir, "index.json"),
      JSON.stringify(deduped, null, 2),
      "utf-8",
    );
    this.cacheIndex = new Map(deduped.map((m) => [m.id, m]));
    return deduped;
  }

  /** 同步读取上次缓存的 manifest 列表（不发起网络请求） */
  listCached(): PluginManifest[] {
    if (this.cacheIndex.size === 0) return [];
    return Array.from(this.cacheIndex.values());
  }

  /** 查找插件（从缓存） */
  find(id: string): PluginManifest | undefined {
    return this.cacheIndex.get(id);
  }

  /** 模糊搜索 */
  search(query: string): PluginManifest[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.listCached();
    return this.listCached().filter((m) => {
      return (
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.description ?? "").toLowerCase().includes(q) ||
        (m.keywords ?? []).some((k) => k.toLowerCase().includes(q))
      );
    });
  }

  // --------------------------------------------------------------------------
  // Install / Upgrade
  // --------------------------------------------------------------------------

  /**
   * 安装插件：
   *   1. 拉取 downloadUrl 的包
   *   2. 校验 sha256（可选）
   *   3. 写入缓存目录 plugins/<id>/<version>/
   *   4. 注册到 installed map
   */
  async install(id: string): Promise<InstalledPluginEntry> {
    const manifest = this.cacheIndex.get(id);
    if (!manifest) throw new Error(`Plugin ${id} not in registry; call refresh() first`);

    this.emit("install:start", id);

    const installPath = path.join(this.cacheDir, "plugins", id, manifest.version);
    await fs.mkdir(installPath, { recursive: true });

    const buf = await this.download(manifest.downloadUrl);
    if (manifest.sha256) {
      const actual = createHash("sha256").update(buf).digest("hex");
      if (actual !== manifest.sha256) {
        throw new Error(
          `sha256 mismatch for ${id}: expected ${manifest.sha256}, got ${actual}`,
        );
      }
    }

    await fs.writeFile(path.join(installPath, "package.bin"), buf);
    await fs.writeFile(
      path.join(installPath, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );

    const entry: InstalledPluginEntry = {
      id,
      manifest,
      installPath,
      enabled: true,
      installedAt: Date.now(),
      updatedAt: Date.now(),
    };

    const prev = this.installed.get(id);
    this.installed.set(id, entry);
    if (prev) {
      this.emit("upgrade:end", entry, prev.manifest.version);
    } else {
      this.emit("install:end", entry);
    }
    return entry;
  }

  async uninstall(id: string): Promise<boolean> {
    const entry = this.installed.get(id);
    if (!entry) return false;
    await fs.rm(path.dirname(entry.installPath), { recursive: true, force: true });
    return this.installed.delete(id);
  }

  /** 列出已安装 */
  listInstalled(): InstalledPluginEntry[] {
    return Array.from(this.installed.values());
  }

  /** 启用 / 禁用 */
  setEnabled(id: string, enabled: boolean): void {
    const entry = this.installed.get(id);
    if (entry) {
      entry.enabled = enabled;
      entry.updatedAt = Date.now();
    }
  }

  // --------------------------------------------------------------------------
  // Network helpers
  // --------------------------------------------------------------------------

  private async fetchSource(source: RegistrySource): Promise<PluginManifest[]> {
    this.emit("fetch:start", source.name);
    if (source.url.startsWith("file://") || source.url.startsWith("/")) {
      const filePath = source.url.replace(/^file:\/\//, "");
      const buf = await fs.readFile(filePath, "utf-8");
      return JSON.parse(buf) as PluginManifest[];
    }

    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= this.fetchRetries; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.fetchTimeoutMs);
        const resp = await fetch(source.url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const body = (await resp.json()) as PluginManifest[];
        return Array.isArray(body) ? body : [];
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        // exponential backoff
        await new Promise((r) => setTimeout(r, Math.min(2000, 200 * Math.pow(2, attempt))));
      }
    }
    throw lastErr ?? new Error("fetch failed");
  }

  private async download(url: string): Promise<Buffer> {
    if (url.startsWith("file://") || url.startsWith("/")) {
      const filePath = url.replace(/^file:\/\//, "");
      return await fs.readFile(filePath);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.fetchTimeoutMs * 4); // longer for download
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const ab = await resp.arrayBuffer();
      return Buffer.from(ab);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ============================================================================
// Utils
// ============================================================================

function dedupeManifests(list: PluginManifest[]): PluginManifest[] {
  const map = new Map<string, PluginManifest>();
  for (const m of list) {
    const existing = map.get(m.id);
    if (!existing) {
      map.set(m.id, m);
      continue;
    }
    // keep the newer one
    const existingDate = new Date(existing.updatedAt ?? 0).getTime();
    const newDate = new Date(m.updatedAt ?? 0).getTime();
    if (newDate > existingDate) map.set(m.id, m);
  }
  return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
}

export function createMarketplace(config: MarketplaceConfig): Marketplace {
  return new Marketplace(config);
}
