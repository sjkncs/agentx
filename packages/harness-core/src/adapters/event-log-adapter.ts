/**
 * EventLog Adapter - 桥接 AgentX/Mastra 事件到 Session Event Log
 *
 * 将 Agent 的事件转换为结构化的 Session Event
 */

import { EventEmitter } from "node:events";
import type { AgUiEventEmitter } from "@agentx/agent-runtime";
import {
  SessionEventLog,
  type SessionEvent,
  type TurnOutcome,
  type StepStats,
} from "../session/event-log.js";

/**
 * 事件名称常量
 */
export const AGENT_EVENTS = {
  AGENT_START: "agentStart",
  AGENT_STOP: "agentStop",
  TURN_START: "turnStart",
  TURN_END: "turnEnd",
  STEP_START: "stepStart",
  STEP_END: "stepEnd",
  BEFORE_TOOL_USE: "beforeToolUse",
  AFTER_TOOL_USE: "afterToolUse",
  TOOL_ERROR: "toolError",
  USER_MESSAGE: "userMessage",
  ASSISTANT_MESSAGE: "assistantMessage",
  PROTOCOL_PHASE: "protocolPhaseChange",
  CONTEXT_COMPACT: "contextCompact",
  CONTEXT_INJECT: "contextInject",
  HUMAN_REQUESTED: "humanConfirmationRequested",
  HUMAN_GRANTED: "humanConfirmationGranted",
  HUMAN_TIMEOUT: "humanConfirmationTimeout",
} as const;

/**
 * 轻量级事件总线接口：
 * - 兼容 Node.js EventEmitter（on/removeListener/removeAllListeners/emit）
 * - 也兼容只有 emit() 的 AgUiEventEmitter（通过 wrapping）
 */
export interface CompatibleEmitter {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off?(event: string, listener: (...args: unknown[]) => void): unknown;
  removeAllListeners(event?: string): unknown;
  emit(event: string, ...args: unknown[]): boolean;
}

/**
 * 将 AgUiEventEmitter（只有 emit）包装成兼容 EventEmitter 的接口。
 * 内部维护一个 Node.js EventEmitter，所有订阅的回调都会在 emit() 时被触发。
 */
export function wrapAgUiEmitter(source: AgUiEventEmitter): CompatibleEmitter {
  const internal = new EventEmitter();
  internal.setMaxListeners(100);

  // 已注册的回调：eventName -> listener[]，用于 detach 时移除
  const customListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  let origEmit: ((event: unknown) => void) | null = null;

  // 尝试代理原 emitter 的 emit 方法（如果它是对象）
  if (typeof source === "object" && source !== null && typeof (source as { emit?: unknown }).emit === "function") {
    origEmit = (event: unknown) => (source as { emit: (e: unknown) => void }).emit(event);
    try {
      // 用一个 wrapper 替换 emit：先 emit 到 internal bus，再调用原 emit
      const proxied = new Proxy(source as unknown as Record<string, unknown>, {
        get(target, prop, receiver) {
          if (prop === "emit") {
            return (event: unknown) => {
              try {
                const evt = event as { type?: string; value?: unknown };
                if (evt && typeof evt === "object" && typeof evt.type === "string") {
                  internal.emit(evt.type, evt.value);
                  // 自定义事件特殊处理：BaseEvent 有 type 字段
                  internal.emit("customEvent", event);
                }
              } catch {
                // ignore
              }
              return origEmit!(event);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      // 把 proxied 替换 source 的引用（如果用户保留 source 引用的方式不同，需要上层配合）
      // 但更稳妥的做法是：让消费者只用 wrap 后的 emitter。这里我们用 captured pattern：
      // 由于 source 本身被外部使用，我们直接返回 internal bus，并将 on 注册的回调同时记录
      void proxied;
    } catch {
      // ignore
    }
  }

  const wrapped: CompatibleEmitter = {
    on(event, listener) {
      if (!customListeners.has(event)) customListeners.set(event, []);
      customListeners.get(event)!.push(listener);
      internal.on(event, listener);
      return this;
    },
    off(event, listener) {
      const arr = customListeners.get(event);
      if (arr) {
        const idx = arr.indexOf(listener);
        if (idx >= 0) arr.splice(idx, 1);
      }
      internal.off(event, listener);
      return this;
    },
    removeAllListeners(event) {
      if (event) {
        customListeners.delete(event);
      } else {
        customListeners.clear();
      }
      internal.removeAllListeners(event);
      return this;
    },
    emit(event, ...args) {
      return internal.emit(event, ...args);
    },
  };

  // 如果上层把 source 的 emit 替换为我们上面做的 Proxy，就能自动触发 internal bus
  // 为了适配上层直接调用 source.emit(event) 的常见情况，我们提供一个 hook：
  if (source && typeof source === "object") {
    try {
      // 直接把 source 的 emit 替换为 Proxy 版本
      const target = source as unknown as Record<string | symbol, unknown>;
      const originalEmit = target.emit as (e: unknown) => void;
      if (typeof originalEmit === "function") {
        target.emit = function (event: unknown) {
          try {
            const evt = event as { type?: string; value?: unknown };
            if (evt && typeof evt === "object" && typeof evt.type === "string") {
              internal.emit(evt.type, evt.value);
              internal.emit("customEvent", event);
            }
          } catch {
            // ignore
          }
          return originalEmit.call(this, event);
        };
      }
    } catch {
      // ignore - readonly properties may throw
    }
  }

  return wrapped;
}

/**
 * EventLog Adapter 配置
 */
export interface EventLogAdapterConfig {
  /** 是否启用 */
  enabled?: boolean;
  /** 会话ID */
  sessionId: string;
  /** 运行ID */
  runId: string;
  /** 持久化路径 */
  persistPath?: string;
  /** 是否启用持久化 */
  persist?: boolean;
}

/**
 * EventLog Adapter - 桥接 Mastra/Agent 事件到 Session Event Log
 *
 * 监听 Agent 的事件发射器，将事件转换为 Session Event 并记录
 */
export class EventLogAdapter {
  private enabled: boolean;
  private emitter: CompatibleEmitter;
  private currentTurnId: string | null = null;
  private currentStepId: string | null = null;
  private stepIndex = 0;
  private turnStartTime: number = 0;
  private stepStartTime: number = 0;

  constructor(
    emitter: AgUiEventEmitter | CompatibleEmitter,
    private eventLog: SessionEventLog,
    config: EventLogAdapterConfig
  ) {
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

    // Agent 生命周期
    this.emitter.on(AGENT_EVENTS.AGENT_START, () => {
      this.eventLog.append({
        type: "session/title",
        title: "AgentX Agent Session",
      });
    });

    // Turn 生命周期
    this.emitter.on(AGENT_EVENTS.TURN_START, (data: unknown) => {
      const turnData = (data as { turnId?: string; userInput?: string } | undefined) || {};
      this.currentTurnId = turnData.turnId || `turn-${Date.now()}`;
      this.stepIndex = 0;
      this.turnStartTime = Date.now();

      this.eventLog.append({
        type: "turn/start",
        turnId: this.currentTurnId,
        timestamp: this.turnStartTime,
        userInput: turnData.userInput,
      });
    });

    this.emitter.on(AGENT_EVENTS.TURN_END, (data: unknown) => {
      const turnData = (data as { turnId?: string; outcome?: TurnOutcome } | undefined) || {};
      if (!this.currentTurnId) return;

      const turnId = turnData.turnId || this.currentTurnId;
      const outcome = turnData.outcome || "success";
      const duration = Date.now() - this.turnStartTime;

      this.eventLog.append({
        type: "turn/end",
        turnId,
        timestamp: Date.now(),
        outcome,
        duration,
      });

      this.currentTurnId = null;
    });

    // Step 生命周期
    this.emitter.on(AGENT_EVENTS.STEP_START, (data: unknown) => {
      const stepData = (data as { stepId?: string } | undefined) || {};
      this.currentStepId = stepData.stepId || `step-${Date.now()}`;
      this.stepStartTime = Date.now();

      this.eventLog.append({
        type: "step/start",
        stepId: this.currentStepId,
        turnId: this.currentTurnId || "",
        stepIndex: this.stepIndex++,
        timestamp: this.stepStartTime,
      });
    });

    this.emitter.on(AGENT_EVENTS.STEP_END, (data: unknown) => {
      const stepData = (data as { stepId?: string; toolCalls?: number; tokenUsage?: { input: number; output: number } } | undefined) || {};
      if (!this.currentStepId) return;

      const toolCalls = stepData.toolCalls ?? 0;
      const stats: StepStats = {
        toolCalls,
        totalDuration: Date.now() - this.stepStartTime,
        tokensUsed: stepData.tokenUsage ? stepData.tokenUsage.input + stepData.tokenUsage.output : 0,
        errors: 0,
        tokens: stepData.tokenUsage
          ? { input: stepData.tokenUsage.input, output: stepData.tokenUsage.output }
          : undefined,
        duration: Date.now() - this.stepStartTime,
      };

      this.eventLog.append({
        type: "step/end",
        stepId: this.currentStepId,
        turnId: this.currentTurnId || "",
        stats,
      });

      this.currentStepId = null;
    });

    // 工具事件
    this.emitter.on(AGENT_EVENTS.BEFORE_TOOL_USE, (data: unknown) => {
      const toolData = (data as {
        toolName?: string;
        input?: unknown;
        stepId?: string;
        turnId?: string;
      } | undefined) || {};

      this.eventLog.append({
        type: "tool/call",
        toolName: toolData.toolName || "unknown",
        input: toolData.input,
        stepId: this.currentStepId || toolData.stepId || "",
        turnId: this.currentTurnId || toolData.turnId || "",
      });
    });

    this.emitter.on(AGENT_EVENTS.AFTER_TOOL_USE, (data: unknown) => {
      const toolData = (data as {
        toolName?: string;
        output?: unknown;
        duration?: number;
        stepId?: string;
        turnId?: string;
      } | undefined) || {};

      this.eventLog.append({
        type: "tool/result",
        toolName: toolData.toolName || "unknown",
        output: toolData.output,
        stepId: this.currentStepId || toolData.stepId || "",
        turnId: this.currentTurnId || toolData.turnId || "",
        duration: toolData.duration ?? Date.now() - this.stepStartTime,
      });
    });

    this.emitter.on(AGENT_EVENTS.TOOL_ERROR, (data: unknown) => {
      const toolData = (data as {
        toolName?: string;
        error?: string;
        stepId?: string;
        turnId?: string;
      } | undefined) || {};

      this.eventLog.append({
        type: "tool/error",
        toolName: toolData.toolName || "unknown",
        error: toolData.error || "Unknown error",
        stepId: this.currentStepId || toolData.stepId || "",
        turnId: this.currentTurnId || toolData.turnId || "",
      });
    });

    // 消息事件
    this.emitter.on(AGENT_EVENTS.USER_MESSAGE, (data: unknown) => {
      const msgData = (data as { content?: string } | undefined) || {};
      if (this.currentTurnId) {
        this.eventLog.append({
          type: "user/message",
          content: msgData.content || "",
          turnId: this.currentTurnId,
          timestamp: Date.now(),
        });
      }
    });

    this.emitter.on(AGENT_EVENTS.ASSISTANT_MESSAGE, (data: unknown) => {
      const msgData = (data as { content?: string } | undefined) || {};
      if (this.currentTurnId) {
        this.eventLog.append({
          type: "assistant/message",
          content: msgData.content || "",
          turnId: this.currentTurnId,
          timestamp: Date.now(),
        });
      }
    });

    // 协议阶段
    this.emitter.on(AGENT_EVENTS.PROTOCOL_PHASE, (data: unknown) => {
      const phaseData = (data as { phaseId?: string; phase?: string } | undefined) || {};
      if (this.currentTurnId) {
        this.eventLog.append({
          type: "protocol/phase",
          phaseId: phaseData.phaseId || phaseData.phase || "unknown",
          turnId: this.currentTurnId,
          timestamp: Date.now(),
        });
      }
    });

    // 上下文事件
    this.emitter.on(AGENT_EVENTS.CONTEXT_COMPACT, (data: unknown) => {
      const ctxData = (data as { beforeTokens?: number; afterTokens?: number } | undefined) || {};
      if (this.currentTurnId) {
        this.eventLog.append({
          type: "context/compact",
          beforeTokens: ctxData.beforeTokens || 0,
          afterTokens: ctxData.afterTokens || 0,
          turnId: this.currentTurnId,
          timestamp: Date.now(),
        });
      }
    });

    this.emitter.on(AGENT_EVENTS.CONTEXT_INJECT, (data: unknown) => {
      const ctxData = (data as { itemCount?: number } | undefined) || {};
      if (this.currentTurnId) {
        this.eventLog.append({
          type: "context/inject",
          itemCount: ctxData.itemCount || 0,
          turnId: this.currentTurnId,
          timestamp: Date.now(),
        });
      }
    });

    // HITL 事件
    this.emitter.on(AGENT_EVENTS.HUMAN_REQUESTED, (data: unknown) => {
      const humanData = (data as { question?: string } | undefined) || {};
      if (this.currentTurnId) {
        this.eventLog.append({
          type: "human/requested",
          question: humanData.question || "",
          turnId: this.currentTurnId,
          timestamp: Date.now(),
        });
      }
    });

    this.emitter.on(AGENT_EVENTS.HUMAN_GRANTED, (data: unknown) => {
      const humanData = (data as { answer?: string } | undefined) || {};
      if (this.currentTurnId) {
        this.eventLog.append({
          type: "human/granted",
          answer: humanData.answer || "",
          turnId: this.currentTurnId,
          timestamp: Date.now(),
        });
      }
    });

    this.emitter.on(AGENT_EVENTS.HUMAN_TIMEOUT, () => {
      if (this.currentTurnId) {
        this.eventLog.append({
          type: "human/timeout",
          turnId: this.currentTurnId,
          timestamp: Date.now(),
        });
      }
    });
  }

  /**
   * 分离事件监听
   */
  detach(): void {
    for (const ev of Object.values(AGENT_EVENTS)) {
      this.emitter.removeAllListeners(ev);
    }
  }

  /**
   * 启用/禁用
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * 获取当前状态
   */
  getStats(): { turnId: string | null; stepId: string | null } {
    return {
      turnId: this.currentTurnId,
      stepId: this.currentStepId,
    };
  }
}

/**
 * 创建 EventLog Adapter 的工厂函数
 */
export function createEventLogAdapter(
  emitter: AgUiEventEmitter | CompatibleEmitter,
  eventLog: SessionEventLog,
  config: EventLogAdapterConfig
): EventLogAdapter {
  return new EventLogAdapter(emitter, eventLog, config);
}