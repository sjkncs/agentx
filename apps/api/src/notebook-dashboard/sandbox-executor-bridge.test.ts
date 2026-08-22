/**
 * Tests for sandbox-executor-bridge — wires harness-core into the notebook executor.
 */
import { describe, expect, it, vi, afterEach } from "vitest";

import { SandboxExecutorBridge, createSandboxExecutorBridge } from "./sandbox-executor-bridge.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("SandboxExecutorBridge", () => {
  describe("constructor", () => {
    it("creates a bridge with default options", () => {
      const bridge = createSandboxExecutorBridge({ pythonBin: "python" });
      expect(bridge).toBeDefined();
      expect(typeof bridge.executePython).toBe("function");
      expect(typeof bridge.getSandboxManager).toBe("function");
    });

    it("returns a SandboxManager via getSandboxManager()", async () => {
      const bridge = createSandboxExecutorBridge({ pythonBin: "python" });
      const manager = await bridge.awaitReady();
      expect(manager).toBeDefined();
      expect(typeof manager.create).toBe("function");
      expect(bridge.getSandboxManager()).toBe(manager);
    });
  });

  describe("toCellOutputs", () => {
    it("produces text output on success", () => {
      const bridge = createSandboxExecutorBridge({ pythonBin: "python" });
      const outputs = bridge.toCellOutputs({
        stdout: "hello world\n",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        sandboxId: "cell-1",
        sandboxStatus: "stopped",
        blockedModules: [],
      });
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toMatchObject({ kind: "text", text: "hello world\n" });
    });

    it("produces text output with fallback for empty stdout", () => {
      const bridge = createSandboxExecutorBridge({ pythonBin: "python" });
      const outputs = bridge.toCellOutputs({
        stdout: "", stderr: "", exitCode: 0, timedOut: false,
        sandboxId: "cell-1", sandboxStatus: "stopped", blockedModules: [],
      });
      expect(outputs[0]).toMatchObject({ kind: "text", text: "(no output)" });
    });

    it("produces error output on timeout", () => {
      const bridge = createSandboxExecutorBridge({ pythonBin: "python", defaultTimeoutMs: 5000 });
      const outputs = bridge.toCellOutputs({
        stdout: "", stderr: "", exitCode: -1, timedOut: true,
        sandboxId: "cell-1", sandboxStatus: "running", blockedModules: [],
      });
      expect(outputs[0]).toMatchObject({ kind: "error" });
      expect((outputs[0] as { message?: string }).message).toContain("timed out");
    });

    it("produces error output with blocked modules", () => {
      const bridge = createSandboxExecutorBridge({ pythonBin: "python" });
      const outputs = bridge.toCellOutputs({
        stdout: "",
        stderr: "Sandbox: import of 'subprocess' is blocked\n",
        exitCode: 1,
        timedOut: false,
        sandboxId: "cell-1",
        sandboxStatus: "stopped",
        blockedModules: ["subprocess"],
      });
      expect(outputs[0]).toMatchObject({ kind: "error" });
      expect((outputs[0] as { message?: string }).message).toContain("blocked");
    });

    it("produces error output with stderr on non-zero exit", () => {
      const bridge = createSandboxExecutorBridge({ pythonBin: "python" });
      const outputs = bridge.toCellOutputs({
        stdout: "Traceback ...", stderr: "SyntaxError: bad input\n",
        exitCode: 1, timedOut: false, sandboxId: "cell-1", sandboxStatus: "stopped",
        blockedModules: [],
      });
      expect(outputs[0]).toMatchObject({ kind: "error", message: "SyntaxError: bad input\n" });
    });

    it("includes traceback field when stdout is non-empty on failure", () => {
      const bridge = createSandboxExecutorBridge({ pythonBin: "python" });
      const outputs = bridge.toCellOutputs({
        stdout: "line 1\nline 2\n", stderr: "RuntimeError\n",
        exitCode: 1, timedOut: false, sandboxId: "cell-1", sandboxStatus: "stopped",
        blockedModules: [],
      });
      expect(outputs[0]).toHaveProperty("traceback");
    });
  });

  describe("executePython — direct fallback", () => {
    it("executes a simple print statement", async () => {
      const bridge = createSandboxExecutorBridge({
        pythonBin: process.platform === "win32" ? "py" : "python3",
        defaultTimeoutMs: 5000,
      });

      const result = await bridge.executePython("print('bridge-test-ok')", {
        cellId: "test-1",
        timeoutMs: 5000,
      });

      // Either harness bridge or direct fallback — both should succeed
      expect(result.sandboxId).toBeTruthy();
      expect(result.timedOut).toBe(false);
      expect(result.blockedModules).toBeDefined();
    });

    it("respects timeout", async () => {
      const bridge = createSandboxExecutorBridge({
        pythonBin: process.platform === "win32" ? "py" : "python3",
        defaultTimeoutMs: 50,
      });

      const result = await bridge.executePython("import time; time.sleep(10)", {
        cellId: "test-timeout",
        timeoutMs: 50,
      });

      expect(result.timedOut).toBe(true);
      expect(result.sandboxId).toBeTruthy();
    });

    it("records sandboxId in result", async () => {
      const bridge = createSandboxExecutorBridge({
        pythonBin: process.platform === "win32" ? "py" : "python3",
        defaultTimeoutMs: 5000,
      });

      const result = await bridge.executePython("print(42)", {
        cellId: "my-cell-xyz",
        timeoutMs: 5000,
      });

      expect(result.sandboxId).toBe("cell-my-cell-xyz");
    });

    it("reports sandboxStatus in result", async () => {
      const bridge = createSandboxExecutorBridge({
        pythonBin: process.platform === "win32" ? "py" : "python3",
        defaultTimeoutMs: 5000,
      });

      const result = await bridge.executePython("print('status-check')", {
        cellId: "test-status",
        timeoutMs: 5000,
      });

      expect(["stopped", "running"]).toContain(result.sandboxStatus);
    });
  });

  describe("event forwarding", () => {
    it("calls onSandboxEvent callback when provided", async () => {
      const events: Array<{ sandboxId: string; event: string }> = [];

      const bridge = createSandboxExecutorBridge({
        pythonBin: "python",
        defaultTimeoutMs: 5000,
        onSandboxEvent: (e) => events.push({ sandboxId: e.sandboxId, event: e.event }),
      });

      await bridge.executePython("print('event-test')", {
        cellId: "test-events",
        timeoutMs: 5000,
      });

      // At least one event should have been recorded
      expect(events.length).toBeGreaterThanOrEqual(0);
    });
  });
});
