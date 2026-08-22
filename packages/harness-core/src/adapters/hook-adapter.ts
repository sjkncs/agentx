/**
 * Hook Adapter - 桥接 DataFoundry/Mastra 事件到 Hook系统
 *
 * 将现有的 Mastra Agent 事件转换为 Hook 事件
 */

import type { AgUiEventEmitter } from "@datafoundry/agent-runtime";
import { createCustomEvent } from "@datafoundry/agent-runtime";
import type { HookEvent, HookContext } from "../hooks/hook-types.js";
import { HookBus } from "../hooks/hook-bus.js";
import { type CompatibleEmitter, wrapAgUiEmitter, AGENT_EVENTS } from "./event-log-adapter.js";

/**
 * Hook Adapter 配置
 */
export interface HookAdapterConfig {
  /** 是否启用 */
  enabled?: boolean;
  /** 默认会话ID */
  sessionId?: string;
  /** 默认运行ID */
  runId?: string;
  /** 默认Agent名称 */
  agentName?: string;
}

/**
 * Hook Adapter - 桥接 Mastra/Agent 事件到 Hook系统
 *
 * 监听 Agent 的事件发射器，将事件转换为 Hook 事件并触发相应的 Hook
 */
export class HookAdapter {
  private sessionId: string;
  private runId: string;
  private agentName: string;
  private enabled: boolean;
  private emitter: CompatibleEmitter;

  constructor(
    emitter: AgUiEventEmitter | CompatibleEmitter,
    private hookBus: HookBus,
    config: HookAdapterConfig = {}
  ) {
    this.sessionId = config.sessionId || "unknown";
    this.runId = config.runId || "unknown";
    this.agentName = config.agentName || "datafoundry";
    this.enabled = config.enabled ?? true;
    // 将 AgUiEventEmitter 包装为兼容 EventEmitter 的接口
    if (typeof (emitter as { on?: unknown }).on === "function") {
      this.emitter = emitter as CompatibleEmitter;
    } else {
      this.emitter = wrapAgUiEmitter(emitter as AgUiEventEmitter);
    }
  }

  /**
   * 附加到事件发射器
   */
  attach(): void {
    if (!this.enabled) return;

    // 监听所有自定义事件
    this.emitter.on("customEvent", (event: unknown) => {
      this.handleEvent(event as ReturnType<typeof createCustomEvent>);
    });

    // 监听 agent.* 事件
    this.emitter.on(AGENT_EVENTS.AGENT_START, (data: unknown) => {
      this.emitHook("agent.start", data);
    });

    this.emitter.on(AGENT_EVENTS.AGENT_STOP, (data: unknown) => {
      this.emitHook("agent.end", data);
    });

    // 监听 turn.* 事件
    this.emitter.on(AGENT_EVENTS.TURN_START, (data: unknown) => {
      this.emitHook("turn.start", data);
    });

    this.emitter.on(AGENT_EVENTS.TURN_END, (data: unknown) => {
      this.emitHook("turn.end", data);
    });

    // 监听 step.* 事件
    this.emitter.on(AGENT_EVENTS.STEP_START, (data: unknown) => {
      this.emitHook("step.start", data);
    });

    this.emitter.on(AGENT_EVENTS.STEP_END, (data: unknown) => {
      this.emitHook("step.end", data);
    });

    // 监听工具事件
    this.emitter.on(AGENT_EVENTS.BEFORE_TOOL_USE, (data: unknown) => {
      const toolData = data as { toolName?: string; input?: unknown } | undefined;
      this.emitHook("tool.pre-execute", data, {
        toolName: toolData?.toolName,
        toolInput: toolData?.input,
      });
    });

    this.emitter.on(AGENT_EVENTS.AFTER_TOOL_USE, (data: unknown) => {
      const toolData = data as { toolName?: string; output?: unknown } | undefined;
      this.emitHook("tool.post-execute", data, {
        toolName: toolData?.toolName,
        toolOutput: toolData?.output,
      });
    });

    this.emitter.on(AGENT_EVENTS.TOOL_ERROR, (data: unknown) => {
      const toolData = data as { toolName?: string; error?: string } | undefined;
      this.emitHook("tool.error", data, {
        toolName: toolData?.toolName,
        error: toolData?.error,
      });
    });

    // 监听 LLM 事件
    this.emitter.on("beforeModelCall", (data: unknown) => {
      this.emitHook("llm.request", data);
    });

    this.emitter.on("afterModelCall", (data: unknown) => {
      this.emitHook("llm.response", data);
    });

    this.emitter.on("modelError", (data: unknown) => {
      this.emitHook("llm.error", data);
    });

    // 监听上下文事件
    this.emitter.on(AGENT_EVENTS.CONTEXT_COMPACT, (data: unknown) => {
      this.emitHook("context.compact", data);
    });

    this.emitter.on(AGENT_EVENTS.CONTEXT_INJECT, (data: unknown) => {
      this.emitHook("context.inject", data);
    });
  }

  /**
   * 分离事件监听
   */
  detach(): void {
    // 移除所有监听器
    const allEvents = [
      "customEvent",
      AGENT_EVENTS.AGENT_START,
      AGENT_EVENTS.AGENT_STOP,
      AGENT_EVENTS.TURN_START,
      AGENT_EVENTS.TURN_END,
      AGENT_EVENTS.STEP_START,
      AGENT_EVENTS.STEP_END,
      AGENT_EVENTS.BEFORE_TOOL_USE,
      AGENT_EVENTS.AFTER_TOOL_USE,
      AGENT_EVENTS.TOOL_ERROR,
      "beforeModelCall",
      "afterModelCall",
      "modelError",
      AGENT_EVENTS.CONTEXT_COMPACT,
      AGENT_EVENTS.CONTEXT_INJECT,
    ];
    for (const ev of allEvents) {
      this.emitter.removeAllListeners(ev);
    }
  }

  /**
   * 更新会话上下文
   */
  updateContext(context: { sessionId?: string; runId?: string; agentName?: string }): void {
    if (context.sessionId) this.sessionId = context.sessionId;
    if (context.runId) this.runId = context.runId;
    if (context.agentName) this.agentName = context.agentName;
  }

  /**
   * 触发Hook
   */
  private emitHook(
    event: HookEvent,
    payload: unknown,
    additionalContext: Record<string, unknown> = {}
  ): void {
    const context: HookContext = {
      event,
      sessionId: this.sessionId,
      runId: this.runId,
      agentName: this.agentName,
      payload,
      metadata: additionalContext,
      toolName: additionalContext.toolName as string | undefined,
      toolInput: additionalContext.toolInput as unknown | undefined,
      toolOutput: additionalContext.toolOutput as unknown | undefined,
      error: additionalContext.error as string | undefined,
    };

    // 异步触发Hook，不阻塞事件流
    this.hookBus.emit(event, context).catch((error: unknown) => {
      console.error(`Hook error for event ${event}:`, error);
    });
  }

  /**
   * 处理自定义事件
   */
  private handleEvent(event: ReturnType<typeof createCustomEvent>): void {
    const eventType = event.type;

    // 映射自定义事件类型到Hook事件
    const hookEventMap: Record<string, HookEvent> = {
      "activity.start": "step.start",
      "activity.end": "step.end",
      "tool.start": "tool.pre-execute",
      "tool.end": "tool.post-execute",
      "llm.start": "llm.request",
      "llm.end": "llm.response",
      "goal.updated": "session.start",
      "goal.completed": "session.end",
      "human.confirmation.requested": "session.start",
      "human.confirmation.granted": "session.end",
    };

    const hookEvent = hookEventMap[eventType] || this.mapCustomEventToHook(eventType);

    if (hookEvent) {
      const eventData = (event as unknown as { data?: unknown }).data;
      this.emitHook(hookEvent, eventData || {}, {
        originalEventType: eventType,
      });
    }
  }

  /**
   * 从自定义事件类型映射到Hook事件
   */
  private mapCustomEventToHook(eventType: string): HookEvent | null {
    // 尝试从事件类型推断
    if (eventType.startsWith("agent/")) {
      return eventType.replace("agent/", "agent.") as HookEvent;
    }
    if (eventType.startsWith("turn/")) {
      return eventType.replace("turn/", "turn.") as HookEvent;
    }
    if (eventType.startsWith("step/")) {
      return eventType.replace("step/", "step.") as HookEvent;
    }
    if (eventType.startsWith("tool/")) {
      return eventType.replace("tool/", "tool.") as HookEvent;
    }
    if (eventType.startsWith("llm/")) {
      return eventType.replace("llm/", "llm.") as HookEvent;
    }
    if (eventType.startsWith("context/")) {
      return eventType.replace("context/", "context.") as HookEvent;
    }
    if (eventType.startsWith("session/")) {
      return eventType.replace("session/", "session.") as HookEvent;
    }
    if (eventType.startsWith("human/")) {
      return eventType.replace("human/", "session.") as HookEvent;
    }

    return null;
  }
}

/**
 * 创建 Hook Adapter 的工厂函数
 */
export function createHookAdapter(
  emitter: AgUiEventEmitter | CompatibleEmitter,
  hookBus: HookBus,
  config?: HookAdapterConfig
): HookAdapter {
  return new HookAdapter(emitter, hookBus, config);
}