/**
 * Gate System - 导出
 */

export {
  GateManager,
  createGateManager,
  type GateManagerEvents,
} from "./gate-manager.js";

export {
  // Built-in executors
  lintGateExecutor,
  testGateExecutor,
  typeCheckGateExecutor,
  buildGateExecutor,
  formatGateExecutor,
  coverageGateExecutor,
  executeCompositeGate,
  builtInExecutors,
} from "./built-in-gates.js";

// Types
export {
  type GateType,
  type GateStatus,
  type GateSeverity,
  type GateIssue,
  type GateResult,
  type GateConfig,
  type GateContext,
  type GateExecutor,
  type CompositeMode,
  type CompositeGateConfig,
  type GatePipeline,
  type PipelineResult,
  type GateManagerConfig,
  type GateStatistics,
  
  // Errors
  GateError,
  GateExecutionError,
  GateTimeoutError,
} from "./gate-types.js";