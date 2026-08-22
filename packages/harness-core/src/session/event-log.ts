/**
 * Session Event Log - 追加写入的事件日志
 * 
 * 提供持久化的会话事件流，支持Fork/Resume
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";

/**
 * Turn 结果
 */
export type TurnOutcome = "success" | "failure" | "partial" | "interrupted";

/**
 * Step 统计
 */
export interface StepStats {
  toolCalls: number;
  totalDuration: number;
  tokensUsed: number;
  errors: number;
  /** 可选的 token 使用详情 */
  tokens?: { input: number; output: number };
  /** 可选的 duration 字段 */
  duration?: number;
}

/**
 * Session Event 类型
 */
export type SessionEvent =
  // Turn 事件
  | { type: "turn/start"; turnId: string; timestamp: number; userInput?: string }
  | { type: "turn/end"; turnId: string; timestamp: number; outcome: TurnOutcome; duration?: number }

  // Step 事件
  | { type: "step/start"; stepId: string; turnId: string; stepIndex: number; timestamp?: number }
  | { type: "step/end"; stepId: string; turnId: string; stats: StepStats }

  // 消息事件
  | { type: "user/message"; content: string; turnId: string; timestamp: number }
  | { type: "assistant/message"; content: string; turnId: string; timestamp: number }
  | { type: "assistant/chunk"; delta: string; messageId: string; turnId: string }

  // 工具事件
  | { type: "tool/call"; toolName: string; input: unknown; stepId: string; turnId: string }
  | { type: "tool/result"; toolName: string; output: unknown; stepId: string; turnId: string; duration: number }
  | { type: "tool/error"; toolName: string; error: string; stepId: string; turnId: string }

  // 协议事件
  | { type: "protocol/phase"; phaseId: string; phase?: string; turnId: string; timestamp?: number }
  | { type: "protocol/action"; actionName: string; stepId: string; turnId: string }

  // 上下文事件
  | { type: "context/inject"; itemCount: number; turnId: string; timestamp?: number }
  | { type: "context/compact"; beforeTokens: number; afterTokens: number; turnId: string; timestamp?: number }

  // Session 元事件
  | { type: "session/title"; title: string }
  | { type: "session/goal"; goal: string }
  | { type: "session/tag"; tag: string }

  // Human-in-the-loop 事件
  | { type: "human/ask"; question: string; turnId: string }
  | { type: "human/answer"; answer: string; turnId: string }
  | { type: "human/requested"; question: string; turnId: string; timestamp?: number }
  | { type: "human/granted"; answer: string; turnId: string; timestamp?: number }
  | { type: "human/timeout"; turnId: string; timestamp?: number };

/**
 * Session Event Log 配置
 */
export interface SessionEventLogConfig {
  /** 事件日志文件路径 */
  logPath?: string;
  /** 是否启用持久化 */
  persist?: boolean;
  /** 批量持久化的间隔 */
  persistInterval?: number;
  /** 最大内存事件数 */
  maxMemoryEvents?: number;
  /** 会话ID */
  sessionId: string;
  /** 运行ID */
  runId: string;
}

/**
 * Session Event Log - 追加写入的事件日志
 */
export class SessionEventLog {
  private events: SessionEvent[] = [];
  private seq = 0;
  private logPath: string | null = null;
  private persistEnabled: boolean;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string;
  private runId: string;
  
  constructor(config: SessionEventLogConfig) {
    this.sessionId = config.sessionId;
    this.runId = config.runId;
    this.persistEnabled = config.persist ?? false;
    
    if (config.logPath && this.persistEnabled) {
      this.logPath = config.logPath;
      this.ensureLogFile();
    }
  }
  
  /**
   * 追加事件
   */
  append(event: SessionEvent): void {
    const enrichedEvent = {
      ...event,
      _seq: this.seq++,
      _timestamp: Date.now(),
      _sessionId: this.sessionId,
      _runId: this.runId,
    } as SessionEvent & { _seq: number; _timestamp: number; _sessionId: string; _runId: string };
    
    this.events.push(enrichedEvent);
    
    // 如果启用了持久化
    if (this.persistEnabled && this.logPath) {
      this.persistSync(enrichedEvent);
    }
  }
  
  /**
   * 追加多个事件
   */
  appendMany(events: SessionEvent[]): void {
    for (const event of events) {
      this.append(event);
    }
  }
  
  /**
   * 获取所有事件
   */
  getEvents(): Array<SessionEvent & { _seq: number; _timestamp: number }> {
    return this.events as Array<SessionEvent & { _seq: number; _timestamp: number }>;
  }
  
  /**
   * 获取事件数量
   */
  getEventCount(): number {
    return this.events.length;
  }
  
  /**
   * 重放事件流
   */
  async *replay(): AsyncIterableIterator<SessionEvent & { _seq: number; _timestamp: number }> {
    for (const event of this.events) {
      yield event as SessionEvent & { _seq: number; _timestamp: number };
    }
  }
  
  /**
   * 从日志文件加载事件
   */
  async loadFromFile(logPath: string): Promise<void> {
    if (!existsSync(logPath)) {
      return;
    }
    
    const content = readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());
    
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        this.events.push(event);
        this.seq = Math.max(this.seq, event._seq + 1);
      } catch {
        // 忽略解析错误
      }
    }
  }
  
  /**
   * Fork 会话
   * 返回新事件序列的起始点
   */
  fork(parentSessionId: string, boundaryTurnId?: string): string {
    const childSessionId = `fork-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    
    // 记录Fork事件
    this.append({
      type: "session/tag",
      tag: `forked_from:${parentSessionId}`,
    });
    
    if (boundaryTurnId) {
      this.append({
        type: "session/tag",
        tag: `fork_boundary:${boundaryTurnId}`,
      });
    }
    
    return childSessionId;
  }
  
  /**
   * 刷新持久化
   */
  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }
  
  /**
   * 获取统计信息
   */
  getStats(): {
    totalEvents: number;
    byType: Record<string, number>;
    firstEventTime: number | null;
    lastEventTime: number | null;
  } {
    const byType: Record<string, number> = {};
    let firstTime: number | null = null;
    let lastTime: number | null = null;
    
    for (const event of this.events) {
      const typedEvent = event as { _timestamp?: number };
      byType[event.type] = (byType[event.type] || 0) + 1;
      
      if (typedEvent._timestamp) {
        if (!firstTime || typedEvent._timestamp < firstTime) {
          firstTime = typedEvent._timestamp;
        }
        if (!lastTime || typedEvent._timestamp > lastTime) {
          lastTime = typedEvent._timestamp;
        }
      }
    }
    
    return {
      totalEvents: this.events.length,
      byType,
      firstEventTime: firstTime,
      lastEventTime: lastTime,
    };
  }
  
  /**
   * 清理资源
   */
  dispose(): void {
    this.flush();
    this.events = [];
  }
  
  private ensureLogFile(): void {
    if (!this.logPath) return;
    
    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    
    if (!existsSync(this.logPath)) {
      writeFileSync(this.logPath, "", "utf-8");
    }
  }
  
  private persistSync(event: SessionEvent & { _seq: number; _timestamp: number }): void {
    if (!this.logPath) return;
    
    try {
      appendFileSync(this.logPath, JSON.stringify(event) + "\n", "utf-8");
    } catch (error) {
      console.error("Failed to persist event:", error);
    }
  }
}

// ============================================================================
// Event Projections
// ============================================================================

/**
 * 从事件流派生消息历史 (兼容Mastra格式)
 */
export function deriveMessages(
  events: (SessionEvent & { _seq?: number; _timestamp?: number })[]
): Array<{ role: "user" | "assistant"; content: string }> {
  return events
    .filter((e) => e.type === "user/message" || e.type === "assistant/message")
    .map((e) => ({
      role: e.type === "user/message" ? "user" : "assistant",
      content: (e as { content: string }).content,
    }));
}

/**
 * 从事件流派生工具调用轨迹
 */
export function deriveToolTrajectory(
  events: (SessionEvent & { _seq?: number; _timestamp?: number })[]
): Array<{
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: string;
  stepId: string;
  turnId: string;
  duration?: number;
}> {
  const calls: Array<{
    toolName: string;
    input: unknown;
    output?: unknown;
    error?: string;
    stepId: string;
    turnId: string;
    duration?: number;
  }> = [];
  
  for (const event of events) {
    if (event.type === "tool/call") {
      calls.push({
        toolName: event.toolName,
        input: event.input,
        stepId: event.stepId,
        turnId: event.turnId,
      });
    } else if (event.type === "tool/result") {
      const lastCall = calls[calls.length - 1];
      if (lastCall && lastCall.toolName === event.toolName) {
        lastCall.output = event.output;
        lastCall.duration = event.duration;
      }
    } else if (event.type === "tool/error") {
      const lastCall = calls[calls.length - 1];
      if (lastCall && lastCall.toolName === event.toolName) {
        lastCall.error = event.error;
      }
    }
  }
  
  return calls;
}

/**
 * 从事件流派生会话摘要
 */
export function deriveSessionSummary(
  events: (SessionEvent & { _seq?: number; _timestamp?: number })[]
): {
  totalSteps: number;
  totalToolCalls: number;
  totalErrors: number;
  duration: number;
  toolUsage: Record<string, number>;
  turnCount: number;
  humanInterruptions: number;
} {
  let totalSteps = 0;
  let totalToolCalls = 0;
  let totalErrors = 0;
  let turnCount = 0;
  let humanInterruptions = 0;
  let firstTime = 0;
  let lastTime = 0;
  const toolUsage: Record<string, number> = {};
  
  for (const event of events) {
    const typedEvent = event as { _timestamp?: number };
    
    if (typedEvent._timestamp) {
      if (!firstTime || typedEvent._timestamp < firstTime) {
        firstTime = typedEvent._timestamp;
      }
      if (!lastTime || typedEvent._timestamp > lastTime) {
        lastTime = typedEvent._timestamp;
      }
    }
    
    if (event.type === "step/end") {
      totalSteps++;
    } else if (event.type === "turn/start") {
      turnCount++;
    } else if (event.type === "tool/call") {
      totalToolCalls++;
      toolUsage[event.toolName] = (toolUsage[event.toolName] || 0) + 1;
    } else if (event.type === "tool/error") {
      totalErrors++;
    } else if (event.type === "human/ask") {
      humanInterruptions++;
    }
  }
  
  return {
    totalSteps,
    totalToolCalls,
    totalErrors,
    duration: lastTime && firstTime ? lastTime - firstTime : 0,
    toolUsage,
    turnCount,
    humanInterruptions,
  };
}
