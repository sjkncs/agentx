/**
 * LatsRuntime: wires the LATS tree-search model into the governed tool execution
 * boundary. It observes every tool success (recordStep) and failure (recordFailure),
 * maintains a MultiPathTrajectory, and emits AG-UI CUSTOM events so the frontend can
 * render the branch DAG.
 *
 * Design constraints:
 * - Backward compatible: when `enabled` is false, all methods are no-ops.
 * - Never throws into the run loop: every emission/reflexion call is guarded so a
 *   LATS failure can never break an otherwise-successful agent run.
 * - Reflexion generation is optional (requires an injected LLMAPI). Without one we
 *   still record the failure and emit events, just without a reflection string.
 *
 * Emitted CUSTOM event names (consumed by apps/web live-run-state.ts):
 *   - "tree.snapshot"          full serialized trajectory for DAG rendering
 *   - "tree.branch.created"    a new branch node was added
 *   - "tree.branch.selected"   UCB selected a new active branch
 *   - "tree.branch.failed"     a branch was marked failed
 *   - "tree.reflexion"         reflection text generated for a failed branch
 */

import { createCustomEvent } from "../events.js";
import type { AgUiEventEmitter } from "../types.js";
import {
  createMultiPathTrajectory,
  selectNextBranchUCB,
  type AgentState,
  type CallBudget,
  type LLMAPI,
  type MultiPathTrajectory,
  type TrajectoryBranch,
} from "./multi-path-trajectory.js";
import {
  generateReflexionForFailure,
  type FailureMode,
} from "./reflexion-generator.js";

export interface LatsRuntimeOptions {
  /** Master switch. When false, all methods no-op (ReAct mode). */
  enabled?: boolean;
  emitter: AgUiEventEmitter;
  /** Optional LLM for Reflexion generation + self-evaluation. */
  llm?: LLMAPI;
  /** Optional seeded failure-mode catalog for template reuse. */
  failureModes?: FailureMode[];
  maxBranchingFactor?: number;
  ucbCoefficient?: number;
  callBudget?: CallBudget;
}

/** Serializable node shape for the frontend DAG. */
export interface SerializedTrajectoryNode {
  nodeId: string;
  parentId: string | null;
  depth: number;
  status: "active" | "failed" | "open";
  score: number | null;
  reflection: string | null;
  /** Tool names executed along this branch (for labels). */
  actions: string[];
  failureReason?: string | undefined;
}

export interface SerializedTrajectory {
  currentNodeId: string;
  nodes: SerializedTrajectoryNode[];
}

export class LatsRuntime {
  private readonly enabled: boolean;
  private readonly emitter: AgUiEventEmitter;
  private readonly llm: LLMAPI | undefined;
  private readonly failureModes: FailureMode[];
  private readonly ucbCoefficient: number;
  private trajectory: MultiPathTrajectory | null = null;

  constructor(options: LatsRuntimeOptions) {
    this.enabled = options.enabled ?? false;
    this.emitter = options.emitter;
    this.llm = options.llm;
    this.failureModes = options.failureModes ?? [];
    this.ucbCoefficient = options.ucbCoefficient ?? 1.4;
    if (this.enabled) {
      this.trajectory = createMultiPathTrajectory(emptyState(), {
        ...(options.maxBranchingFactor !== undefined
          ? { maxBranchingFactor: options.maxBranchingFactor }
          : {}),
        ...(options.callBudget ? { callBudget: options.callBudget } : {}),
      });
    }
  }

  /** Whether LATS tree tracking is active for this run. */
  get isActive(): boolean {
    return this.enabled && this.trajectory !== null;
  }

  /** Record a successful tool execution on the active branch. */
  recordStep(input: { toolName: string; toolInput?: unknown; rawResult?: unknown }): void {
    if (!this.isActive || !this.trajectory) return;
    try {
      const current = this.trajectory.nodes.get(this.trajectory.currentNodeId);
      if (!current) return;
      current.history.push({
        stepIndex: current.history.length,
        thought: `executed ${input.toolName}`,
        action: { name: input.toolName, args: toArgs(input.toolInput) },
        result: input.rawResult,
        timestamp: Date.now(),
      });
      this.emitSnapshot();
    } catch {
      // Never break the run loop.
    }
  }

  /**
   * Record a tool failure: mark the branch failed, generate Reflexion (if an LLM is
   * available), then open a recovery child branch and select it via UCB.
   */
  async recordFailure(input: { toolName: string; error: unknown; toolInput?: unknown }): Promise<void> {
    if (!this.isActive || !this.trajectory) return;
    try {
      const trajectory = this.trajectory;
      const current = trajectory.nodes.get(trajectory.currentNodeId);
      if (!current) return;

      const failureReason = describeError(input.error);
      current.failureReason = failureReason;

      this.emit("tree.branch.failed", {
        nodeId: current.nodeId,
        failureReason,
      });

      // Generate Reflexion when an LLM is wired (best-effort).
      if (this.llm) {
        const reflection = await generateReflexionForFailure(
          { history: current.history, failureReason },
          this.llm,
          this.failureModes,
        );
        current.reflection = reflection;
        this.emit("tree.reflexion", { nodeId: current.nodeId, reflection });
      }

      // Open a recovery child branch carrying the reflection forward.
      const child = spawnRecoveryChild(trajectory, current);
      this.emit("tree.branch.created", {
        nodeId: child.nodeId,
        parentId: current.nodeId,
        depth: child.depth,
      });

      trajectory.currentNodeId = child.nodeId;
      this.emit("tree.branch.selected", { nodeId: child.nodeId });
      this.emitSnapshot();
    } catch {
      // Never break the run loop.
    }
  }

  /** Select the next branch via UCB (exposed for tests / orchestration). */
  selectNext(): string | null {
    if (!this.isActive || !this.trajectory) return null;
    const selected = selectNextBranchUCB(this.trajectory, this.ucbCoefficient);
    if (selected) this.emit("tree.branch.selected", { nodeId: selected });
    return selected;
  }

  /** Serialize the current trajectory for the frontend DAG. */
  snapshot(): SerializedTrajectory | null {
    if (!this.trajectory) return null;
    return serializeTrajectory(this.trajectory);
  }

  private emitSnapshot(): void {
    const snapshot = this.snapshot();
    if (snapshot) this.emit("tree.snapshot", snapshot);
  }

  private emit(name: string, value: unknown): void {
    this.emitter.emit(createCustomEvent(name, value));
  }
}

/** Build a serializable view of the trajectory. */
export function serializeTrajectory(trajectory: MultiPathTrajectory): SerializedTrajectory {
  const nodes: SerializedTrajectoryNode[] = [];
  for (const branch of trajectory.nodes.values()) {
    nodes.push({
      nodeId: branch.nodeId,
      parentId: branch.parentId,
      depth: branch.depth,
      status: nodeStatus(trajectory, branch),
      score: branch.score,
      reflection: branch.reflection,
      actions: branch.history.map((step) => step.action.name),
      ...(branch.failureReason ? { failureReason: branch.failureReason } : {}),
    });
  }
  // Stable ordering for deterministic rendering/tests.
  nodes.sort((a, b) => a.depth - b.depth || a.nodeId.localeCompare(b.nodeId));
  return { currentNodeId: trajectory.currentNodeId, nodes };
}

function nodeStatus(
  trajectory: MultiPathTrajectory,
  branch: TrajectoryBranch,
): SerializedTrajectoryNode["status"] {
  if (branch.failureReason) return "failed";
  if (branch.nodeId === trajectory.currentNodeId) return "active";
  return "open";
}

/** Create a recovery child branch from a failed parent. */
function spawnRecoveryChild(
  trajectory: MultiPathTrajectory,
  parent: TrajectoryBranch,
): TrajectoryBranch {
  const childId = `${parent.nodeId}/recovery/${parent.children.size}`;
  const child: TrajectoryBranch = {
    nodeId: childId,
    parentId: parent.nodeId,
    history: [...parent.history],
    currentState: structuredClone(parent.currentState),
    score: null,
    reflection: parent.reflection,
    children: new Set(),
    depth: parent.depth + 1,
    visits: 0,
    valueSum: 0,
  };
  trajectory.nodes.set(childId, child);
  parent.children.add(childId);
  return child;
}

function toArgs(toolInput: unknown): Record<string, unknown> {
  if (typeof toolInput === "object" && toolInput !== null && !Array.isArray(toolInput)) {
    return toolInput as Record<string, unknown>;
  }
  return {};
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "unknown error";
  }
}

function emptyState(): AgentState {
  return { conversationHistory: [], attachments: [] };
}
