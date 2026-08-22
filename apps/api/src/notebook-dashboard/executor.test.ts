import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeCell } from "./executor.js";
import type { NotebookCell } from "./types.js";

interface FakeGatewayCall {
  method: string;
  args: unknown[];
}

function makeFakeGateway(overrides: Partial<{
  runSqlReadonly: ReturnType<typeof vi.fn>;
  listDataSources: ReturnType<typeof vi.fn>;
}> = {}) {
  const calls: FakeGatewayCall[] = [];
  const gateway = {
    runSqlReadonly: overrides.runSqlReadonly ?? vi.fn(async () => {
      calls.push({ method: "runSqlReadonly", args: [] });
      return {
        columns: ["n"],
        rows: [[1]],
        truncated: false,
        audit_log_id: "audit-1",
        elapsed_ms: 12,
      };
    }),
    listDataSources: overrides.listDataSources ?? vi.fn(async () => {
      calls.push({ method: "listDataSources", args: [] });
      return [{ id: "ds-1", name: "sample" }];
    }),
  };
  return { gateway, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("executeCell", () => {
  it("runs a SQL cell via the gateway", async () => {
    const { gateway } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "sql",
      source: "SELECT 1 AS n",
      status: "idle",
      outputs: [],
    };
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
    });
    expect(result.status).toBe("completed");
    expect(result.auditLogId).toBe("audit-1");
    expect(result.rowCount).toBe(1);
    expect(result.outputs[0]).toMatchObject({ kind: "table", columns: ["n"] });
    expect(gateway.runSqlReadonly).toHaveBeenCalledTimes(1);
  });

  it("falls back to the first registered datasource when none is given", async () => {
    const { gateway, calls } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "sql",
      source: "SELECT 1",
      status: "idle",
      outputs: [],
    };
    await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
    });
    expect(calls.some((c) => c.method === "listDataSources")).toBe(true);
  });

  it("returns a typed error when no datasource is registered", async () => {
    const gateway = {
      listDataSources: async () => [],
      runSqlReadonly: vi.fn(),
    };
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "sql",
      source: "SELECT 1",
      status: "idle",
      outputs: [],
    };
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
    });
    expect(result.status).toBe("failed");
    expect(result.outputs[0]?.kind).toBe("error");
    expect(result.errorMessage).toContain("datasource");
  });

  it("runs an AI prompt cell when a completion callback is provided", async () => {
    const { gateway } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "ai-prompt",
      source: "Summarise the last run",
      status: "idle",
      outputs: [],
    };
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
      completePrompt: async (prompt) => `echo: ${prompt}`,
    });
    expect(result.status).toBe("completed");
    expect(result.outputs[0]).toMatchObject({
      kind: "text",
      text: "echo: Summarise the last run",
    });
  });

  it("returns a typed error when AI completion is missing", async () => {
    const { gateway } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "ai-prompt",
      source: "x",
      status: "idle",
      outputs: [],
    };
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toContain("completion");
  });

  it("treats markdown cells as a no-op", async () => {
    const { gateway } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "markdown",
      source: "# hi",
      status: "idle",
      outputs: [],
    };
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
    });
    expect(result.status).toBe("completed");
    expect(result.outputs[0]).toMatchObject({ kind: "text" });
  });

  it("returns a typed error when python runtime is missing", async () => {
    const { gateway } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "python",
      source: "print(1)",
      status: "idle",
      outputs: [],
    };
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage?.toLowerCase()).toContain("python runtime");
  });

  it("runs a Python cell via the provided interpreter and captures stdout", async () => {
    const { gateway } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "python",
      source: "print('hello')",
      status: "idle",
      outputs: [],
    }
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
      pythonBin: process.platform === "win32" ? "py" : "python3",
    });
    if (result.status === "completed") {
      expect(result.outputs[0]).toMatchObject({ kind: "text", text: /hello/ });
    } else {
      // The CI runner may not have python on PATH — accept either party,
      // but a non-completed run must include a descriptive error.
      expect(result.errorMessage).toBeTruthy();
    }
  });

  it("aborts long-running cells with a timeout", async () => {
    const { gateway } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "python",
      source: "import time; time.sleep(5)",
      status: "idle",
      outputs: [],
    };
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
      pythonBin: process.platform === "win32" ? "py" : "python3",
      timeoutMs: 50,
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toBeTruthy();
  });

  // ── Sandbox tests ──────────────────────────────────────────────────────────────

  it("sandbox: blocks subprocess import", async () => {
    const { gateway } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "python",
      source: "import subprocess; subprocess.run(['echo', 'pwned'], shell=True)",
      status: "idle",
      outputs: [],
    };
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
      pythonBin: process.platform === "win32" ? "py" : "python3",
      timeoutMs: 5000,
      sandbox: { networkIsolation: { type: "none" } },
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/blocked|Sandbox|not available/);
  });

  it("sandbox: blocks socket import", async () => {
    const { gateway } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "python",
      source: "import socket; s = socket.socket()",
      status: "idle",
      outputs: [],
    };
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
      pythonBin: process.platform === "win32" ? "py" : "python3",
      timeoutMs: 5000,
      sandbox: { networkIsolation: { type: "none" } },
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/blocked|Sandbox|socket/);
  });

  it("sandbox: blocks urllib.request", async () => {
    const { gateway } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "python",
      source: "import urllib.request",
      status: "idle",
      outputs: [],
    };
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
      pythonBin: process.platform === "win32" ? "py" : "python3",
      timeoutMs: 5000,
      sandbox: { networkIsolation: { type: "none" } },
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/blocked|Sandbox|urllib/);
  });

  it("sandbox: allows safe imports like json and math", async () => {
    const { gateway } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "python",
      source: "import json, math; print(json.dumps({'pi': math.pi}))",
      status: "idle",
      outputs: [],
    };
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
      pythonBin: process.platform === "win32" ? "py" : "python3",
      timeoutMs: 5000,
      sandbox: { networkIsolation: { type: "none" } },
    });
    if (result.status === "completed") {
      expect(result.outputs[0]).toMatchObject({ kind: "text" });
      expect((result.outputs[0] as { text: string }).text).toContain("3.14");
    } else {
      // Accept failure when python isn't available on CI
      expect(result.errorMessage).toBeTruthy();
    }
  });

  it("sandbox: blocks exec builtins", async () => {
    const { gateway } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "python",
      source: "exec('print(1)')",
      status: "idle",
      outputs: [],
    };
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
      pythonBin: process.platform === "win32" ? "py" : "python3",
      timeoutMs: 5000,
      sandbox: { networkIsolation: { type: "none" } },
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/not callable|NameError|blocked|NoneType/);
  });

  it("sandbox: blocks open builtins", async () => {
    const { gateway } = makeFakeGateway();
    const cell: NotebookCell = {
      id: "cell-1",
      kind: "python",
      source: "f = open('/etc/passwd')",
      status: "idle",
      outputs: [],
    };
    const result = await executeCell(cell, {
      workspaceId: "ws-1",
      userId: "user-1",
      gateway: gateway as never,
      pythonBin: process.platform === "win32" ? "py" : "python3",
      timeoutMs: 5000,
      sandbox: { networkIsolation: { type: "none" } },
    });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/NoneType|not callable|blocked|NameError/);
  });
});
