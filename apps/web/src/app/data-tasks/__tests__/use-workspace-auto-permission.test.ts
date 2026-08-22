import { describe, it, expect } from "vitest";
import {
  isPathInScope,
  normalizePath,
  isHighRiskPath,
  explainPermissionDecision,
  DEFAULT_AUTO_PERMISSION_STATE,
  type AutoPermissionState,
} from "../use-workspace-auto-permission";

describe("isPathInScope", () => {
  it("returns false when scope is empty", () => {
    expect(isPathInScope("/foo", "")).toBe(false);
    expect(isPathInScope("/foo", "   ")).toBe(false);
  });

  it("matches by prefix (case-insensitive)", () => {
    expect(isPathInScope("/workspace/projects/a.ts", "/workspace/projects")).toBe(true);
    expect(isPathInScope("/WORKSPACE/PROJECTS/a.ts", "/workspace/projects")).toBe(true);
  });

  it("normalizes backslash and trailing slashes", () => {
    expect(isPathInScope("\\workspace\\projects\\a.ts", "/workspace/projects")).toBe(true);
    expect(isPathInScope("/workspace/projects/a.ts", "/workspace/projects/")).toBe(true);
  });

  it("rejects paths outside scope", () => {
    expect(isPathInScope("/etc/passwd", "/workspace/projects")).toBe(false);
    expect(isPathInScope("/workspace_other/a.ts", "/workspace/projects")).toBe(false);
  });

  it("honors denied list", () => {
    expect(
      isPathInScope("/workspace/projects/secret.txt", "/workspace/projects", [
        "/workspace/projects/secret.txt",
      ]),
    ).toBe(false);
    expect(
      isPathInScope("/workspace/projects/ok.txt", "/workspace/projects", [
        "/workspace/projects/secret.txt",
      ]),
    ).toBe(true);
  });
});

describe("normalizePath", () => {
  it("normalizes backslash to forward slash", () => {
    expect(normalizePath("a\\b\\c")).toBe("a/b/c");
  });
  it("lowercases", () => {
    expect(normalizePath("Foo/Bar")).toBe("foo/bar");
  });
  it("strips trailing slashes", () => {
    expect(normalizePath("/foo/bar/")).toBe("/foo/bar");
  });
});

describe("isHighRiskPath", () => {
  it("detects traversal", () => {
    expect(isHighRiskPath("/ws/../etc/passwd")).toBe(true);
    expect(isHighRiskPath("\\ws\\..\\foo")).toBe(true);
  });
  it("detects sensitive dirs", () => {
    expect(isHighRiskPath("/ws/.env")).toBe(true);
    expect(isHighRiskPath("/ws/node_modules/foo")).toBe(true);
    expect(isHighRiskPath("/ws/.git/config")).toBe(true);
  });
  it("detects executable extensions", () => {
    expect(isHighRiskPath("/ws/run.exe")).toBe(true);
    expect(isHighRiskPath("/ws/run.sh")).toBe(true);
    expect(isHighRiskPath("/ws/run.PS1")).toBe(true);
  });
  it("allows normal files", () => {
    expect(isHighRiskPath("/ws/src/index.ts")).toBe(false);
    expect(isHighRiskPath("/ws/README.md")).toBe(false);
  });
});

describe("explainPermissionDecision", () => {
  const baseState: AutoPermissionState = { ...DEFAULT_AUTO_PERMISSION_STATE, enabled: true, scope: "/ws" };

  it("denies when disabled", () => {
    const result = explainPermissionDecision({ ...DEFAULT_AUTO_PERMISSION_STATE }, {
      kind: "write",
      path: "/ws/a.ts",
    });
    expect(result).toEqual({ allowed: false, reason: "auto-permission disabled" });
  });

  it("denies paths outside scope", () => {
    const result = explainPermissionDecision(baseState, { kind: "write", path: "/etc/passwd" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/outside workspace scope/);
  });

  it("denies high-risk paths even within scope", () => {
    const result = explainPermissionDecision(baseState, { kind: "write", path: "/ws/.env" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/high-risk path/);
  });

  it("allows write within scope (any level)", () => {
    expect(explainPermissionDecision({ ...baseState, level: "low" }, { kind: "write", path: "/ws/a.ts" }).allowed).toBe(true);
    expect(explainPermissionDecision({ ...baseState, level: "medium" }, { kind: "write", path: "/ws/a.ts" }).allowed).toBe(true);
    expect(explainPermissionDecision({ ...baseState, level: "high" }, { kind: "write", path: "/ws/a.ts" }).allowed).toBe(true);
  });

  it("blocks shell at low level, allows at medium/high", () => {
    expect(
      explainPermissionDecision({ ...baseState, level: "low" }, { kind: "shell", path: "/ws/run.sh" }).allowed,
    ).toBe(false);
    expect(
      explainPermissionDecision({ ...baseState, level: "medium" }, { kind: "shell", path: "/ws/run.sh" }).allowed,
    ).toBe(true);
    expect(
      explainPermissionDecision({ ...baseState, level: "high" }, { kind: "shell", path: "/ws/run.sh" }).allowed,
    ).toBe(true);
  });

  it("always denies delete", () => {
    expect(
      explainPermissionDecision({ ...baseState, level: "high" }, { kind: "delete", path: "/ws/x" }).allowed,
    ).toBe(false);
  });

  it("blocks external at medium, allows at high", () => {
    expect(
      explainPermissionDecision({ ...baseState, level: "medium" }, { kind: "external" }).allowed,
    ).toBe(false);
    expect(
      explainPermissionDecision({ ...baseState, level: "high" }, { kind: "external" }).allowed,
    ).toBe(true);
  });
});

describe("autoElevate", () => {
  // Import directly to keep this test pure (no React DOM needed).
  it("enables auto-permission, sets scope, and elevates level to medium by default", async () => {
    const mod = await import("../use-workspace-auto-permission");
    const result = mod.autoElevateForTesting("/workspace/proj");
    expect(result.enabled).toBe(true);
    expect(result.scope).toBe("/workspace/proj");
    expect(result.level).toBe("medium");
  });

  it("respects explicit targetLevel", async () => {
    const mod = await import("../use-workspace-auto-permission");
    expect(mod.autoElevateForTesting("/w", "high").level).toBe("high");
  });
});
