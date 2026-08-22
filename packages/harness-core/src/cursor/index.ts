/**
 * Cursor SDK System - 导出
 */

export {
  CursorSdkAdapter,
  LocalCursorSdkAdapter,
  CloudCursorSdkAdapter,
  createCursorSdkAdapter,
  type CursorSdkEvents,
} from "./cursor-adapter.js";

export {
  IdeResidentWorkflow,
  createIdeResidentWorkflow,
  type IdeWorkflowEvents,
} from "./ide-workflow.js";

// Types
export {
  type CursorFileContext,
  type CursorSelection,
  type CursorPosition,
  type CursorIdeContext,
  type CursorAgentType,
  type CursorAgentStatus,
  type CursorAgentRequest,
  type CursorAgentResponse,
  type CursorFileEdit,
  type CursorToolCall,
  type CursorStreamEventType,
  type CursorStreamEvent,
  type CursorSdkConfig,
  
  // Errors
  CursorSdkError,
  CursorConnectionError,
  CursorAgentError,
} from "./cursor-types.js";