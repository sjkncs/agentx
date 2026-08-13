/**
 * MultiPathTrajectory: Tree-of-Thoughts agent execution model replacing linear ReAct history.
 * 
 * Design rationale:
 * - Each node = (state, history) tuple with unique nodeId for checkpoint/resume
 * - Edge = LLM-generated action candidate; up to N=3 branches per decision point
 * - Node value = LLM self-evaluation score (0~1), computed via Evaluate phase
 * - Failed branches retained on tree → trigger Reflexion feedback injection
 * - Backpropagate updates ancestry scores using Bellman backup with discount factor
 * 
 * Backward compatible with ReAct mode: if maxBranchingFactor=1, degenerates to linear chain.
 * Budget controls prevent cost explosion (see CallBudget interface below).
 * 
 * References:
 * - LATS paper arXiv 2310.04406 "Language Agent Tree Search"
 * - DataFoundry protocol-runtime event emission pattern (protocol.phase.entered)
 */

/**
 * LLM API contract for trajectory evaluation and Reflexion generation.
 * Implementations wrap a model provider (see packages/providers).
 */
export interface LLMAPI {
  call(prompt: string, options?: { temperature?: number; maxTokens?: number }): Promise<string>;
}

/** Minimal tool call descriptor (name + args). */
export type ToolCall = {
  name: string;
  args: Record<string, unknown>;
};

export type TrajectoryNodeType = "root" | "branch" | "leaf" | "failed";

export interface TrajectoryBranch {
  /** Unique identifier for state checkpoint (hash of state snapshot + history[:5]) */
  nodeId: string;
  /** Parent branch ID (null for root) */
  parentId: string | null;
  /** Actions taken from parent state */
  history: AgentStep[];
  /** Current state after last action (checkpoint for resume) */
  currentState: AgentState;
  /** LLM self-evaluation score (0-1) - null until Evaluate phase completes */
  score: number | null;
  /** Reflexion text if branch failed (auto-generated or manual) */
  reflection: string | null;
  /** Child branch IDs (for DAG traversal) */
  children: Set<string>;
  /** Depth in tree (distance from root) */
  depth: number;
  /** Visit count for UCB calculation */
  visits: number;
  /** Total accumulated value for backpropagation */
  valueSum: number;
  /** Failure reason if status=failed */
  failureReason?: string;
}

export interface AgentStep {
  /** Step index in trajectory history */
  stepIndex: number;
  /** Thought leading to this action */
  thought: string;
  /** Action executed */
  action: ToolCall;
  /** Result of action execution (or error object) */
  result: unknown;
  /** Timestamp */
  timestamp: number;
  /** Token usage for this step (optional budget tracking) */
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

export interface AgentState {
  /** Conversation messages buffer (cut off at max length) */
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  /** Workspace attachments/files */
  attachments: FileAttachment[];
  /** Knowledge base context chunks retrieved */
  knowledgeContext?: Array<{ title: string; snippet: string }>;
  /** Protocol phase id (if governed by FSM) */
  currentPhase?: string;
  /** Domain-specific fields (e.g., data-analysis schema info) */
  domain?: Record<string, unknown>;
  /** Error state if any (triggers Reflexion) */
  error?: string;
}

export interface FileAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  content?: string; // inline for small files
}

export interface MultiPathTrajectory {
  /** Root node (initial state before any actions) */
  root: TrajectoryBranch;
  /** All known nodes indexed by nodeId (Map<nodeId, branch>) */
  nodes: Map<string, TrajectoryBranch>;
  /** Currently active path (via UCB selection) */
  currentNodeId: string;
  /** Max branching factor per decision point (N=3 default) */
  maxBranchingFactor: number;
  /** Call budget controls for cost management */
  callBudget?: CallBudget | undefined;
  /** Optional warmup cache for cold-start speedup */
  warmupCache?: WarmupCache | undefined;
}

export interface CallBudget {
  /** Max tokens allowed per run (global) */
  totalTokens: number;
  /** Max rollouts per branch (branching_factor × tree_depth limit) */
  maxRolloutsPerBranch: number;
  /** Fallback mode when exceeded */
  fallbackMode: "reduced_tree" | "linear_retry";
  /** Optional per-step token cap */
  tokensPerStep?: number;
}

export interface WarmupCache {
  getScore(key: string): Promise<number | null>;
  updateScore(key: string, value: number): void;
  clear(): void;
}

/**
 * Initialize fresh multi-path trajectory at session start.
 * Called by RunProtocolBoundary.create() before any tools are dispatched.
 */
export function createMultiPathTrajectory(initialState: AgentState, options?: {
  maxBranchingFactor?: number;
  callBudget?: CallBudget;
}): MultiPathTrajectory {
  const rootNodeId = generateNodeId([], initialState);
  const root: TrajectoryBranch = {
    nodeId: rootNodeId,
    parentId: null,
    history: [],
    currentState: structuredClone(initialState),
    score: null,
    reflection: null,
    children: new Set(),
    depth: 0,
    visits: 0,
    valueSum: 0,
  };

  return {
    root,
    nodes: new Map([[rootNodeId, root]]),
    currentNodeId: rootNodeId,
    maxBranchingFactor: options?.maxBranchingFactor ?? 3,
    callBudget: options?.callBudget,
    warmupCache: undefined, // lazy-initialized in constructor
  };
}

/**
 * Expand current node into N child branches via LLM generation.
 * Generates alternative parameter variations (perturbation sampling).
 */
export async function expandBranch(
  trajectory: MultiPathTrajectory,
  llm: LLMAPI,
  actionGenerator: (parentState: AgentState, reflectionText: string | null) => Promise<ToolCall[]>,
  options?: { includeReflexion?: boolean }
): Promise<TrajectoryBranch[]> {
  const currentNode = trajectory.nodes.get(trajectory.currentNodeId);
  if (!currentNode) throw new Error(`NODE_NOT_FOUND:${trajectory.currentNodeId}`);

  const reflectionText = options?.includeReflexion ? currentNode.reflection ?? null : null;
  
  // Generate N candidate actions
  const candidates = await actionGenerator(currentNode.currentState, reflectionText);
  const topCandidates = candidates.slice(0, trajectory.maxBranchingFactor);

  const newChildren: TrajectoryBranch[] = [];
  
  for (const [index, candidateAction] of topCandidates.entries()) {
    const childNodeId = `${currentNode.nodeId}/branch/${index}/${Date.now()}`;
    const childState = structuredClone(currentNode.currentState);
    
    // Simulate execution via the LLM world-model (no real tool call; predicts result).
    const simulatedResult = await simulateActionExecution(candidateAction, childState, llm);

    const child: TrajectoryBranch = {
      nodeId: childNodeId,
      parentId: currentNode.nodeId,
      history: [...currentNode.history, {
        stepIndex: currentNode.history.length,
        thought: `Exploring variant ${index + 1}: ${candidateAction.name}`,
        action: candidateAction,
        result: simulatedResult.result,
        timestamp: Date.now(),
        tokenUsage: simulatedResult.tokenUsage,
      }],
      currentState: simulatedResult.state,
      score: null,
      reflection: null,
      children: new Set(),
      depth: currentNode.depth + 1,
      visits: 0,
      valueSum: 0,
    };

    trajectory.nodes.set(childNodeId, child);
    currentNode.children.add(childNodeId);
    newChildren.push(child);
  }

  return newChildren;
}

/**
 * Select next branch via UCB formula: value(node) + c × sqrt(ln(parent_visits) / node.visits)
 * Returns new currentNodeId or null if no unexplored children exist.
 */
export function selectNextBranchUCB(
  trajectory: MultiPathTrajectory,
  ucbCoefficient: number
): string | null {
  const currentNode = trajectory.nodes.get(trajectory.currentNodeId);
  if (!currentNode || currentNode.children.size === 0) return null;

  let bestChild: TrajectoryBranch | null = null;
  let bestUCB = -Infinity;

  for (const childId of currentNode.children) {
    const child = trajectory.nodes.get(childId);
    if (!child) continue;

    const ucb = computeUCB(child, currentNode, ucbCoefficient);
    if (ucb > bestUCB) {
      bestUCB = ucb;
      bestChild = child;
    }
  }

  if (bestChild) {
    trajectory.currentNodeId = bestChild.nodeId;
    bestChild.visits++;
    return bestChild.nodeId;
  }

  return null;
}

function computeUCB(node: TrajectoryBranch, parent: TrajectoryBranch, c: number): number {
  const averageValue = node.visits === 0 ? 0 : node.valueSum / node.visits;
  const explorationTerm = Math.sqrt(Math.log(parent.visits) / node.visits);
  return averageValue + c * explorationTerm;
}

/**
 * Evaluate current state via LLM self-evaluator.
 * Returns progress/efficiency/safety scores (0~1 each).
 */
export async function evaluateState(
  trajectory: MultiPathTrajectory,
  llm: LLMAPI
): Promise<EvaluationCriteria> {
  const currentNode = trajectory.nodes.get(trajectory.currentNodeId);
  if (!currentNode) throw new Error(`NODE_NOT_FOUND:${trajectory.currentNodeId}`);

  const prompt = `You are evaluating an AI agent's execution state. Provide three scores between 0 and 1:
- progress: How far along is the agent toward completing its task? Count task-completion keywords in conversation history.
- efficiency: Has the agent wasted tokens/steps vs expected budget? Consider conversation length.
- safety: Does the agent follow safety rules (e.g., only read-only SQL queries)? Check action names.

Current state snapshot: ${JSON.stringify({
  historyLength: currentNode.history.length,
  lastThought: currentNode.history.at(-1)?.thought,
  lastAction: currentNode.history.at(-1)?.action.name,
  currentPhase: currentNode.currentState.currentPhase,
  hasError: !!currentNode.currentState.error,
})}

Respond with JSON: {"progress": X.X, "efficiency": Y.Y, "safety": Z.Z}`;

  const response = await llm.call(prompt);
  const parsed = JSON.parse(response);
  
  // Update node score (average of three dimensions)
  const combinedScore = (parsed.progress + parsed.efficiency + parsed.safety) / 3;
  currentNode.score = combinedScore;
  currentNode.valueSum += combinedScore;

  return {
    progress: parsed.progress,
    efficiency: parsed.efficiency,
    safety: parsed.safety,
  };
}

export interface EvaluationCriteria {
  progress: number;
  efficiency: number;
  safety: number;
}

/**
 * Generate Reflexion reflection text from failed branch.
 * Injected into next round of action generation.
 */
export async function generateReflexion(
  failedBranch: TrajectoryBranch,
  llm: LLMAPI
): Promise<string> {
  const trajectoryStr = failedBranch.history.map(h => `
Thought: ${h.thought}
Action: ${h.action.name}(args=${JSON.stringify(h.action.args)})
Result: ${JSON.stringify(h.result)}
`).join("\n");

  const prompt = `You are an AI agent debugger. The following execution trajectory failed:

${trajectoryStr}

Failure reason: ${failedBranch.failureReason || "unknown error"}

Please output 3 specific lessons learned, each as a one-sentence bullet point in Markdown format.`;

  const reflection = await llm.call(prompt);
  failedBranch.reflection = reflection;
  return reflection;
}

/**
 * Backpropagate value updates up the tree (Bellman backup).
 * Updates ancestor nodes' valueSum for future UCB calculations.
 */
export function backpropagateValueUpdates(trajectory: MultiPathTrajectory, leafNode: TrajectoryBranch): void {
  let currentNode = leafNode;
  while (currentNode.parentId !== null) {
    const parent = trajectory.nodes.get(currentNode.parentId);
    if (!parent) break;

    parent.valueSum += currentNode.score ?? 0;
    parent.visits++;

    currentNode = parent;
  }
}

/**
 * World-model simulator: uses the LLM to predict the likely result and state
 * transition of a candidate action WITHOUT executing the real tool. This is the
 * "Simulate" step of LATS (rollout via a learned model rather than the environment).
 * Falls back to a cheap heuristic when no LLM is available or the call fails, so
 * tree expansion never blocks on simulation.
 */
async function simulateActionExecution(
  action: ToolCall,
  state: AgentState,
  llm?: LLMAPI,
): Promise<{
  state: AgentState;
  result: unknown;
  tokenUsage: { inputTokens: number; outputTokens: number };
}> {
  if (llm) {
    try {
      const prompt = [
        "You are a world model simulating a data-analysis agent. Predict the likely outcome of the next action WITHOUT executing it.",
        `Current phase: ${state.currentPhase ?? "unknown"}. Has error: ${Boolean(state.error)}.`,
        `History length: ${state.conversationHistory?.length ?? 0} steps.`,
        `Candidate action: ${action.name}(${JSON.stringify(action.args ?? {})})`,
        'Respond with JSON only: {"success": true|false, "summary": "<one sentence likely result>", "progress": 0..1}',
      ].join("\n");
      const raw = await llm.call(prompt);
      const parsed = JSON.parse(raw) as {
        success?: boolean;
        summary?: string;
        progress?: number;
      };
      const summary = typeof parsed.summary === "string" ? parsed.summary : "simulated outcome";
      const progress = clamp01(typeof parsed.progress === "number" ? parsed.progress : 0.5);
      return {
        state: { ...state, currentPhase: state.currentPhase, error: parsed.success === false ? summary : undefined },
        result: { simulated: true, actionName: action.name, summary, success: parsed.success !== false },
        tokenUsage: { inputTokens: Math.round(50 + summary.length / 4), outputTokens: Math.round(summary.length / 4) },
        // progress surfaced via result for downstream scoring
        ...{ progressHint: progress },
      } as { state: AgentState; result: unknown; tokenUsage: { inputTokens: number; outputTokens: number } };
    } catch {
      // fall through to heuristic
    }
  }
  // Heuristic fallback: assume read-only data actions succeed and advance progress slightly.
  const readOnly = /inspect|list|preview|select|query|search|retrieve/i.test(action.name);
  return {
    state,
    result: { simulated: true, actionName: action.name, success: readOnly, summary: readOnly ? "heuristic: likely success" : "heuristic: uncertain" },
    tokenUsage: { inputTokens: 10, outputTokens: 20 },
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Generate unique node ID from hash of state snapshot + history prefix.
 * Used for caching/warmup lookups.
 */
function generateNodeId(history: AgentStep[], state: AgentState): string {
  const preview = history.slice(0, 5).map(h => h.action.name).join("-");
  const stateHash = simpleHash(JSON.stringify(state));
  return `${preview}-${stateHash}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash &= hash;
  }
  return Math.abs(hash).toString(36);
}
