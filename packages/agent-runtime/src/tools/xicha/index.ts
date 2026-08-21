/**
 * xicha/index.ts — A27 喜茶食安 Agent 导出
 */

// Main Agent
export { XichaFSDAgent, type XichaFSDConfig, type XichaFSDAgentInput, type XichaFSDAgentResult } from "./xicha-fsd-agent.js";

// Subagents
export {
  FoodSafetySubagent,
  type IntentClassifyOutput,
  type ReplyGenerateOutput,
  type AuditOutput,
} from "./food-safety-subagent.js";

export {
  WorkOrderSubagent,
  type WorkOrderCreateInput,
  type WorkOrderCreateOutput,
  type WorkOrderEscalateInput,
  type WorkOrderStageAdvanceInput,
  type CompensationApproveInput,
} from "./wo-subagent.js";

// Orchestrator
export {
  XichaFSDOrchestrator,
  type XichaOrchestratorConfig,
  type OrchestratedResult,
  type NotifyEvent,
} from "./xicha-orchestrator.js";
