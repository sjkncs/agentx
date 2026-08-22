/**
 * Sandbox System - 导出
 */

export {
  Sandbox,
  ProcessSandbox,
  VmSandbox,
  DockerSandbox,
  WebContainerSandbox,
  createSandbox,
  type SandboxEvents,
} from "./sandbox.js";

export {
  SandboxManager,
  createSandboxManager,
  type SandboxManagerEvents,
} from "./sandbox-manager.js";

// Types
export {
  type SandboxType,
  type FilePermission,
  type NetworkPermission,
  type EnvPermission,
  type SandboxPermissions,
  type SandboxResourceLimits,
  type SandboxConfig,
  type SandboxExecutionRequest,
  type SandboxExecutionResult,
  type SandboxStatus,
  type SandboxInfo,
  type SandboxManagerConfig,
  
  // Errors
  SandboxError,
  SandboxStartError,
  SandboxExecutionError,
  SandboxTimeoutError,
  PermissionDeniedError,
} from "./sandbox-types.js";