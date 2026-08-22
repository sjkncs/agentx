/**
 * Worktree Helper - 轻量级 git worktree 封装
 *
 * 为普通用户提供"看 diff 做版本管理"的入口，省去每次手动 git 命令。
 *
 * 设计目标：
 *   - 不依赖 shell（直接调 git 二进制，避免 sandbox 中转）
 *   - 列出当前仓库的所有 worktree
 *   - 提供基于文件内容的简单 diff 接口
 *   - 完全只读：用户必须自己点 apply 才落地
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

// ============================================================================
// Types
// ============================================================================

export interface WorktreeEntry {
  /** worktree path */
  path: string;
  /** HEAD commit */
  head: string;
  /** branch or detached HEAD */
  ref: string;
  /** dirty flag (uncommitted changes) */
  dirty: boolean;
}

export interface DiffRequest {
  /** repo path */
  repoPath: string;
  /** base ref (commit/branch/tag) */
  base: string;
  /** head ref */
  head: string;
  /** 可选：仅限制到这些路径 */
  paths?: string[];
}

export interface DiffFile {
  file: string;
  /** A=added, M=modified, D=deleted, R=renamed */
  changeType: "A" | "M" | "D" | "R";
  /** numstat: additions, deletions */
  additions: number;
  deletions: number;
  /** base→head patch (truncated if huge) */
  patch: string;
  binary?: boolean;
}

export interface DiffResult {
  base: string;
  head: string;
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
}

// ============================================================================
// Helpers
// ============================================================================

/** Run `git` and capture stdout. */
async function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd, shell: false });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`git ${args.join(" ")} failed (${code}): ${err.trim()}`));
    });
  });
}

// ============================================================================
// API
// ============================================================================

export class WorktreeHelper {
  /**
   * 列出仓库的全部 worktree（包含主 working tree）。
   * 解析 `git worktree list --porcelain`。
   */
  static async list(repoPath: string): Promise<WorktreeEntry[]> {
    const out = await runGit(["worktree", "list", "--porcelain"], repoPath);
    const entries: WorktreeEntry[] = [];
    const blocks = out.split(/\n\n/).filter(Boolean);
    for (const block of blocks) {
      const lines = block.split("\n");
      const entry: WorktreeEntry = {
        path: "",
        head: "",
        ref: "",
        dirty: false,
      };
      for (const line of lines) {
        const m = /^(\S+)\s+(.+)$/.exec(line);
        if (!m) continue;
        if (m[1] === "worktree") entry.path = m[2];
        else if (m[1] === "HEAD") entry.head = m[2];
        else if (m[1] === "branch") entry.ref = m[2].replace(/^refs\/heads\//, "");
        else if (m[1] === "detached") entry.ref = "detached";
        else if (m[1] === "dirty") entry.dirty = true;
      }
      if (entry.path) entries.push(entry);
    }
    return entries;
  }

  /** 在指定的 worktree 上跑 `git diff`，解析为结构化的 DiffResult */
  static async diff(req: DiffRequest, opts?: { maxPatchBytes?: number }): Promise<DiffResult> {
    const args = ["diff", "--numstat", `${req.base}...${req.head}`];
    if (req.paths?.length) {
      args.push("--", ...req.paths);
    }
    const numstat = await runGit(args, req.repoPath).catch((err) => {
      // fall back to plain diff if numstat unsupported
      if (err instanceof Error) return "";
      throw err;
    });

    const files: DiffFile[] = [];
    let totalA = 0;
    let totalD = 0;

    if (numstat.trim()) {
      for (const line of numstat.split("\n")) {
        if (!line.trim()) continue;
        const [a, d, file] = line.split("\t");
        const binary = a === "-" && d === "-";
        const additions = binary ? 0 : parseInt(a, 10) || 0;
        const deletions = binary ? 0 : parseInt(d, 10) || 0;
        totalA += additions;
        totalD += deletions;
        const changeType: DiffFile["changeType"] = binary
          ? "M"
          : additions > 0 && deletions === 0
            ? "A"
            : deletions > 0 && additions === 0
              ? "D"
              : "M";
        files.push({
          file,
          changeType,
          additions,
          deletions,
          patch: "",
          binary,
        });
      }
    }

    // Fetch patch per file (cap each patch)
    const maxBytes = opts?.maxPatchBytes ?? 64 * 1024;
    for (const file of files) {
      if (file.binary) continue;
      try {
        const patch = await runGit(
          ["diff", `${req.base}...${req.head}`, "--", file.file],
          req.repoPath,
        );
        file.patch = patch.length > maxBytes ? patch.slice(0, maxBytes) + "\n...truncated..." : patch;
      } catch {
        file.patch = "<patch unavailable>";
      }
    }

    return {
      base: req.base,
      head: req.head,
      files,
      totalAdditions: totalA,
      totalDeletions: totalD,
    };
  }

  /**
   * 在指定目录下运行 git 命令把 diff 结果落盘（默认写到 .harness/diffs/）。
   * 供 UI 层"导出 diff"按钮使用。
   */
  static async exportToDir(diff: DiffResult, dir: string): Promise<string> {
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `diff-${safeRef(diff.base)}..${safeRef(diff.head)}.json`);
    await fs.writeFile(filePath, JSON.stringify(diff, null, 2), "utf-8");
    return filePath;
  }

  /** 读最近 commit 列表（用于版本管理 UI） */
  static async log(repoPath: string, opts?: { limit?: number }): Promise<Array<{ sha: string; subject: string; author: string; date: string }>> {
    const limit = opts?.limit ?? 20;
    const fmt = "%H%x1f%s%x1f%an%x1f%aI";
    const out = await runGit(["log", `-n`, String(limit), `--pretty=format:${fmt}`], repoPath);
    return out.split("\n").filter(Boolean).map((line) => {
      const [sha, subject, author, date] = line.split("\x1f");
      return { sha, subject, author, date };
    });
  }
}

function safeRef(ref: string): string {
  return ref.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 64);
}

export function createWorktreeHelper(): typeof WorktreeHelper {
  return WorktreeHelper;
}
