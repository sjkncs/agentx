/**
 * Subagent System - 导出
 */

export {
  Subagent,
  type SubagentEvents,
  createSubagent,
} from "./subagent.js";

export {
  SubagentManager,
  createSubagentManager,
  type SubagentManagerEvents,
} from "./subagent-manager.js";

export {
  Orchestrator,
  createOrchestrator,
} from "./orchestrator.js";

// Types
export {
  type SubagentStatus,
  type SubagentRole,
  type SubagentConfig,
  type SubagentIsolation,
  type SubagentModelConfig,
  type SubagentToolConfig,
  type SubagentRun,
  type SubagentStep,
  type SubagentResult,
  type OrchestrationMode,
  type OrchestrationTask,
  type Orchestration,
  type OrchestrationResult,
  type MessageType,
  type SubagentMessage,
  type SubagentManagerConfig,
  type SubagentStats,
  
  // Errors
  SubagentError,
  SubagentSpawnError,
  SubagentTimeoutError,
  SubagentNotFoundError,
  OrchestrationError,
} from "./subagent-types.js";
