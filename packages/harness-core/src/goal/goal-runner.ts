/**
 * Goal Mode - 目标驱动执行循环
 *
 * 借鉴 ZCode 的 `/goal` 设计：
 *   - 用户给出可验证目标 → Agent 围绕目标持续迭代
 *   - 每轮结束自动做 goal verification
 *   - 验证通过 → 任务结束；不通过 → 下一轮（带预算）
 *
 * 目标必须可二值判断，因此提供两种 verifier：
 *   - `predicate`:  自定义函数
 *   - `regExp`:     检查最终输出是否匹配
 *   - `gateResult`: 用 GateManager 跑测试门控
 *   - `command`:    跑 shell 命令，exit 0 视为通过
 */

import { EventEmitter } from "node:events";

// ============================================================================
// Types
// ============================================================================

export type GoalVerifier =
  | { type: "predicate"; fn: (output: GoalIterationOutput) => boolean | Promise<boolean>; description?: string }
  | { type: "regExp"; pattern: string; flags?: string; description?: string }
  | { type: "gateResult"; gateName: string; description?: string }
  | { type: "command"; command: string; args?: string[]; description?: string };

export interface GoalConfig {
  /** 目标描述（注入到每轮 prompt 引导 Agent 推进） */
  goal: string;
  /** 验证器 */
  verifier: GoalVerifier;
  /** 单轮 Agent 调用的入口，由用户实现 */
  runner: (iteration: GoalIteration) => Promise<GoalIterationOutput>;
  /** 最大轮数，默认 8 */
  maxRounds?: number;
  /** 单轮超时（ms），默认 300_000 */
  iterationTimeoutMs?: number;
  /** 失败时是否把 verifier feedback 注入下一轮 prompt */
  injectFeedback?: boolean;
  /** 整体目标超时（ms），默认 maxRounds * iterationTimeoutMs */
  overallTimeoutMs?: number;
  /** Agent 收到反馈时的额外上下文（可选） */
  contextBuilder?: (iteration: GoalIterationOutput) => string | Promise<string>;
}

export interface GoalIterationOutput {
  /** Agent 第 N 轮的输出（自由结构） */
  output: unknown;
  /** 自由文本总结，会拼回下一轮 prompt */
  summary: string;
  /** 迭代统计 */
  stats?: {
    durationMs: number;
    toolCalls?: number;
    tokensUsed?: number;
  };
}

export interface GoalIteration extends GoalIterationOutput {
  round: number;
  goal: string;
  previousFeedback?: string;
}

export interface GoalRunResult {
  status: "passed" | "exhausted" | "failed" | "timeout";
  rounds: number;
  history: GoalIteration[];
  finalOutput?: unknown;
  failureReason?: string;
}

export interface GoalModeEvents {
  "goal:start": [result: GoalRunResult];
  "goal:iteration:start": [iteration: GoalIteration];
  "goal:iteration:end": [iteration: GoalIteration];
  "goal:verify": [round: number, passed: boolean];
  "goal:end": [result: GoalRunResult];
}

// ============================================================================
// Goal Runner
// ============================================================================

export class GoalRunner extends EventEmitter<GoalModeEvents> {
  private readonly config: Required<Pick<GoalConfig, "maxRounds" | "iterationTimeoutMs" | "injectFeedback" | "overallTimeoutMs">> & GoalConfig;

  constructor(config: GoalConfig) {
    super();
    this.config = {
      maxRounds: 8,
      iterationTimeoutMs: 300_000,
      injectFeedback: true,
      overallTimeoutMs: 0, // computed below
      ...config,
    } as GoalRunner["config"];
    if (!this.config.overallTimeoutMs) {
      this.config.overallTimeoutMs = this.config.maxRounds * this.config.iterationTimeoutMs;
    }
  }

  async run(): Promise<GoalRunResult> {
    const history: GoalIteration[] = [];
    const startedAt = Date.now();

    this.emit("goal:start", { status: "running", rounds: 0, history: [] } as unknown as GoalRunResult);

    for (let round = 1; round <= this.config.maxRounds; round++) {
      // Overall timeout check
      if (Date.now() - startedAt > this.config.overallTimeoutMs) {
        return this.fail("timeout", round, history, "Overall timeout exceeded");
      }

      const previousFeedback = this.buildPreviousFeedback(history);
      const iter: GoalIteration = {
        round,
        goal: this.config.goal,
        previousFeedback,
        output: undefined,
        summary: "",
      };
      this.emit("goal:iteration:start", iter);

      try {
        const output = await this.runOneIteration(iter);
        iter.output = output.output;
        iter.summary = output.summary;
        iter.stats = output.stats;
        history.push(iter);
        this.emit("goal:iteration:end", iter);

        // Verify
        const passed = await this.verify(iter);
        this.emit("goal:verify", round, passed);
        if (passed) {
          const final: GoalRunResult = {
            status: "passed",
            rounds: round,
            history,
            finalOutput: iter.output,
          };
          this.emit("goal:end", final);
          return final;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        history.push({
          ...iter,
          summary: `Iteration failed: ${message}`,
          output: undefined,
        });
        return this.fail("failed", round, history, message);
      }
    }

    return this.fail("exhausted", this.config.maxRounds, history, "Max rounds reached without verification passing");
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async runOneIteration(prev: GoalIteration): Promise<GoalIterationOutput> {
    // Compose context and run with timeout
    const prompt = prev.previousFeedback
      ? `Goal: ${this.config.goal}\n\nPrevious feedback: ${prev.previousFeedback}`
      : `Goal: ${this.config.goal}`;

    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<GoalIterationOutput>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Iteration timeout (${this.config.iterationTimeoutMs}ms)`)),
        this.config.iterationTimeoutMs,
      );
    });

    const startedAt = Date.now();
    try {
      const result = await Promise.race([
        Promise.resolve(this.config.runner({
          round: prev.round,
          goal: prev.goal,
          previousFeedback: prev.previousFeedback,
          output: undefined,
          summary: "",
        })),
        timeoutPromise,
      ]);
      const durationMs = Date.now() - startedAt;
      return {
        output: result.output,
        summary: result.summary,
        stats: { ...(result.stats ?? {}), durationMs },
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private buildPreviousFeedback(history: GoalIteration[]): string | undefined {
    if (!this.config.injectFeedback || history.length === 0) return undefined;
    const last = history[history.length - 1];
    if (!last) return undefined;
    const verifierHint = this.config.verifier.description;
    return (
      `Round ${last.round} output (summary): ${last.summary}\n` +
      (verifierHint ? `Verifier: ${verifierHint}\n` : "")
    );
  }

  private async verify(iter: GoalIteration): Promise<boolean> {
    const v = this.config.verifier;
    const output: GoalIterationOutput = {
      output: iter.output,
      summary: iter.summary,
      stats: iter.stats,
    };

    switch (v.type) {
      case "predicate":
        return Boolean(await Promise.resolve(v.fn(output)));
      case "regExp": {
        const re = new RegExp(v.pattern, v.flags);
        return re.test(typeof iter.output === "string" ? iter.output : iter.summary);
      }
      case "command": {
        // Lazy import to avoid pulling child_process for browser users
        const { spawn } = await import("node:child_process");
        return await new Promise<boolean>((resolve) => {
          const proc = spawn(v.command, v.args ?? [], {
            shell: true,
            env: process.env,
          });
          let resolved = false;
          const finish = (val: boolean) => {
            if (resolved) return;
            resolved = true;
            resolve(val);
          };
          proc.on("exit", (code) => finish(code === 0));
          proc.on("error", () => finish(false));
        });
      }
      case "gateResult":
        // gateResult stays as metadata; consumers should run a GateManager and call verifier
        return false;
      default:
        return false;
    }
  }

  private fail(
    status: GoalRunResult["status"],
    rounds: number,
    history: GoalIteration[],
    reason: string,
  ): GoalRunResult {
    const final: GoalRunResult = {
      status,
      rounds,
      history,
      failureReason: reason,
    };
    this.emit("goal:end", final);
    return final;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createGoalRunner(config: GoalConfig): GoalRunner {
  return new GoalRunner(config);
}
