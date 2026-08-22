import { NextResponse } from "next/server";

import { WorktreeHelper } from "../../../../../../packages/harness-core/src/worktree/worktree";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

/**
 * GET /api/diff?repo=<path>&base=<ref>&head=<ref>
 *
 * 用 harness-core 的 WorktreeHelper 跑 git diff。
 * - base/head 可以是 branch、tag、SHA
 * - repo 必须是文件系统上存在 git 仓库的路径
 * - 默认 patch 单文件最多 64KB（防止超大 diff 把前端拖死）
 */

interface DiffApiOk {
  ok: true;
  data: {
    base: string;
    head: string;
    files: Array<{
      file: string;
      changeType: "A" | "M" | "D" | "R";
      additions: number;
      deletions: number;
      binary?: boolean;
      patch?: string;
    }>;
    totalAdditions: number;
    totalDeletions: number;
  };
}
interface DiffApiErr {
  ok: false;
  error: string;
}

function ok(data: DiffApiOk["data"]): NextResponse<DiffApiOk> {
  return NextResponse.json<DiffApiOk>({ ok: true, data });
}
function err(message: string, status = 400): NextResponse<DiffApiErr> {
  return NextResponse.json<DiffApiErr>({ ok: false, error: message }, { status });
}

export async function GET(request: Request): Promise<NextResponse<DiffApiOk | DiffApiErr>> {
  const url = new URL(request.url);
  const repo = url.searchParams.get("repo");
  const base = url.searchParams.get("base") ?? "main";
  const head = url.searchParams.get("head") ?? "HEAD";

  if (!repo) {
    return err("Missing 'repo' query parameter");
  }
  if (!/^[A-Za-z0-9_./-]+$/.test(repo)) {
    return err("Invalid 'repo' path");
  }

  try {
    const result = await WorktreeHelper.diff({ repoPath: repo, base, head }, { maxPatchBytes: 64 * 1024 });
    return ok({
      base: result.base,
      head: result.head,
      files: result.files.map((f) => ({
        file: f.file,
        changeType: f.changeType,
        additions: f.additions,
        deletions: f.deletions,
        binary: f.binary,
        patch: f.patch,
      })),
      totalAdditions: result.totalAdditions,
      totalDeletions: result.totalDeletions,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`git diff failed: ${message}`, 500);
  }
}
