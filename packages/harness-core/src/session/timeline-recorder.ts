/**
 * Timeline Recorder - 细粒度的时间线记录器
 * 
 * 用于记录 Agent Loop 中的每一步操作，形成可追溯的时间线
 */

import type { SessionEventLog, SessionEvent } from "./event-log.js";

/**
 * Timeline Entry - 时间线条目
 */
export interface TimelineEntry {
  /** 唯一ID */
  id: string;
  /** 父条目ID (用于构建树结构) */
  parentId: string | null;
  /** 条目类型 */
  type: TimelineEntryType;
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime?: number;
  /** 持续时间 (毫秒) */
  duration?: number;
  /** 数据 */
  data: Record<string, unknown>;
  /** 状态 */
  status: "pending" | "running" | "completed" | "failed";
  /** 子条目 */
  children: TimelineEntry[];
}

/**
 * Timeline Entry 类型
 */
export type TimelineEntryType =
  | "session"
  | "turn"
  | "step"
  | "llm_call"
  | "tool_call"
  | "context_update"
  | "hook_execution"
  | "custom";

/**
 * Timeline Recorder 配置
 */
export interface TimelineRecorderConfig {
  /** 会话ID */
  sessionId: string;
  /** 运行ID */
  runId: string;
  /** 是否启用 */
  enabled?: boolean;
  /** 最大条目数 */
  maxEntries?: number;
  /** 是否自动同步到EventLog */
  syncToEventLog?: boolean;
}

/**
 * Timeline Recorder - 细粒度时间线记录器
 */
export class TimelineRecorder {
  private enabled: boolean;
  private maxEntries: number;
  private syncToEventLog: boolean;
  private entries: TimelineEntry[] = [];
  private rootEntry: TimelineEntry | null = null;
  private currentEntry: TimelineEntry | null = null;
  private entryStack: TimelineEntry[] = [];
  
  constructor(
    private eventLog: SessionEventLog,
    config: TimelineRecorderConfig
  ) {
    this.enabled = config.enabled ?? true;
    this.maxEntries = config.maxEntries ?? 10000;
    this.syncToEventLog = config.syncToEventLog ?? true;
    
    // 创建根条目
    this.rootEntry = this.createEntry("session", {
      sessionId: config.sessionId,
      runId: config.runId,
      startTime: Date.now(),
    });
    this.entries.push(this.rootEntry);
    this.currentEntry = this.rootEntry;
  }
  
  /**
   * 开始一个条目
   */
  startEntry(
    type: TimelineEntryType,
    data: Record<string, unknown> = {}
  ): string {
    if (!this.enabled) return "";
    
    const entry = this.createEntry(type, {
      startTime: Date.now(),
      ...data,
    });
    
    // 设置父子关系
    entry.parentId = this.currentEntry?.id || null;
    if (this.currentEntry) {
      this.currentEntry.children.push(entry);
    }
    
    // 入栈
    this.entryStack.push(this.currentEntry || ({} as TimelineEntry));
    this.currentEntry = entry;
    
    // 添加到列表
    this.entries.push(entry);
    
    // 裁剪
    this.trim();
    
    return entry.id;
  }
  
  /**
   * 结束当前条目
   */
  endEntry(id: string, data: Record<string, unknown> = {}): void {
    if (!this.enabled) return;
    
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || entry.status !== "pending") return;
    
    const endTime = Date.now();
    entry.endTime = endTime;
    entry.duration = endTime - entry.startTime;
    entry.status = "completed";
    Object.assign(entry.data, data);
    
    // 出栈
    if (this.entryStack.length > 0) {
      this.currentEntry = this.entryStack.pop()!;
    } else {
      this.currentEntry = this.rootEntry;
    }
    
    // 同步到 EventLog
    if (this.syncToEventLog) {
      this.syncToEventLogEntry(entry);
    }
  }
  
  /**
   * 标记条目失败
   */
  failEntry(id: string, error: string): void {
    if (!this.enabled) return;
    
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || entry.status !== "pending") return;
    
    entry.endTime = Date.now();
    entry.duration = entry.endTime - entry.startTime;
    entry.status = "failed";
    entry.data.error = error;
    
    // 出栈
    if (this.entryStack.length > 0) {
      this.currentEntry = this.entryStack.pop()!;
    } else {
      this.currentEntry = this.rootEntry;
    }
    
    // 同步到 EventLog
    if (this.syncToEventLog) {
      this.syncToEventLogEntry(entry);
    }
  }
  
  /**
   * 获取当前条目
   */
  getCurrentEntry(): TimelineEntry | null {
    return this.currentEntry;
  }
  
  /**
   * 获取根条目
   */
  getRootEntry(): TimelineEntry | null {
    return this.rootEntry;
  }
  
  /**
   * 获取所有条目
   */
  getEntries(): TimelineEntry[] {
    return [...this.entries];
  }
  
  /**
   * 获取条目统计
   */
  getStats(): {
    totalEntries: number;
    byType: Record<TimelineEntryType, number>;
    byStatus: Record<string, number>;
    totalDuration: number;
  } {
    const byType: Partial<Record<TimelineEntryType, number>> = {};
    const byStatus: Record<string, number> = {};
    let totalDuration = 0;
    
    for (const entry of this.entries) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
      totalDuration += entry.duration || 0;
    }
    
    return {
      totalEntries: this.entries.length,
      byType: byType as Record<TimelineEntryType, number>,
      byStatus,
      totalDuration,
    };
  }
  
  /**
   * 获取时间线树
   */
  getTree(): TimelineEntry {
    return this.buildTree(this.rootEntry);
  }
  
  /**
   * 导出为 JSON
   */
  toJSON(): string {
    return JSON.stringify(this.getTree(), null, 2);
  }
  
  /**
   * 清理
   */
  dispose(): void {
    if (this.rootEntry && this.rootEntry.status === "pending") {
      this.failEntry(this.rootEntry.id, "TimelineRecorder disposed");
    }
    this.entries = [];
    this.entryStack = [];
    this.rootEntry = null;
    this.currentEntry = null;
  }
  
  // ============================================================================
  // Helper Methods
  // ============================================================================
  
  private createEntry(
    type: TimelineEntryType,
    data: Record<string, unknown>
  ): TimelineEntry {
    return {
      id: `tl-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      parentId: null,
      type,
      startTime: Date.now(),
      data,
      status: "pending",
      children: [],
    };
  }
  
  private trim(): void {
    while (this.entries.length > this.maxEntries) {
      const oldest = this.entries[0];
      if (oldest.parentId === null) {
        // 不裁剪根条目
        break;
      }
      
      // 找到父条目并移除
      const parent = this.entries.find((e) => e.id === oldest.parentId);
      if (parent) {
        const index = parent.children.indexOf(oldest);
        if (index !== -1) {
          parent.children.splice(index, 1);
        }
      }
      
      this.entries.shift();
    }
  }
  
  private syncToEventLogEntry(entry: TimelineEntry): void {
    switch (entry.type) {
      case "turn":
        if (entry.status === "completed") {
          this.eventLog.append({
            type: "turn/end",
            turnId: entry.id,
            timestamp: entry.endTime!,
            outcome: "success",
            duration: entry.duration,
          });
        } else if (entry.status === "failed") {
          this.eventLog.append({
            type: "tool/error",
            toolName: "timeline",
            error: String(entry.data.error),
            stepId: "",
            turnId: entry.id,
          });
        }
        break;
        
      case "step":
        if (entry.status === "completed") {
          this.eventLog.append({
            type: "step/end",
            stepId: entry.id,
            turnId: entry.parentId || "",
            stats: {
              toolCalls: (entry.data.toolCalls as number) || 0,
              totalDuration: entry.duration || 0,
              tokensUsed: (entry.data.tokensUsed as number) || 0,
              errors: 0,
            },
          });
        }
        break;
        
      case "tool_call":
        if (entry.status === "completed") {
          this.eventLog.append({
            type: "tool/result",
            toolName: String(entry.data.toolName),
            output: entry.data.output,
            stepId: entry.parentId || "",
            turnId: this.findTurnId(entry),
            duration: entry.duration || 0,
          });
        } else if (entry.status === "failed") {
          this.eventLog.append({
            type: "tool/error",
            toolName: String(entry.data.toolName),
            error: String(entry.data.error),
            stepId: entry.parentId || "",
            turnId: this.findTurnId(entry),
          });
        }
        break;
        
      case "llm_call":
        // LLM 调用暂时不在 EventLog 中记录细节
        break;
    }
  }
  
  private findTurnId(entry: TimelineEntry): string {
    let current: TimelineEntry | null = entry;
    while (current) {
      if (current.type === "turn") {
        return current.id;
      }
      current = this.entries.find((e) => e.id === current?.parentId) || null;
    }
    return "";
  }
  
  private buildTree(entry: TimelineEntry | null): TimelineEntry {
    if (!entry) {
      return this.createEntry("session", { empty: true });
    }
    
    return {
      ...entry,
      children: entry.children.map((child) => this.buildTree(child)),
    };
  }
}

// ============================================================================
// Timeline Helper Functions
// ============================================================================

/**
 * 创建 TimelineRecorder 的便捷函数
 */
export function createTimelineRecorder(
  eventLog: SessionEventLog,
  config: TimelineRecorderConfig
): TimelineRecorder {
  return new TimelineRecorder(eventLog, config);
}

/**
 * 记录 LLM 调用
 */
export async function recordLLMCall<T>(
  recorder: TimelineRecorder,
  fn: () => Promise<T>,
  data: Record<string, unknown> = {}
): Promise<T> {
  const entryId = recorder.startEntry("llm_call", data);
  
  try {
    const result = await fn();
    recorder.endEntry(entryId, { result: "success" });
    return result;
  } catch (error) {
    recorder.failEntry(entryId, String(error));
    throw error;
  }
}

/**
 * 记录工具调用
 */
export async function recordToolCall<T>(
  recorder: TimelineRecorder,
  toolName: string,
  fn: () => Promise<T>,
  data: Record<string, unknown> = {}
): Promise<T> {
  const entryId = recorder.startEntry("tool_call", {
    toolName,
    ...data,
  });
  
  try {
    const result = await fn();
    recorder.endEntry(entryId, { output: result });
    return result;
  } catch (error) {
    recorder.failEntry(entryId, String(error));
    throw error;
  }
}

/**
 * 记录 Step
 */
export async function recordStep<T>(
  recorder: TimelineRecorder,
  fn: () => Promise<T>,
  data: Record<string, unknown> = {}
): Promise<T> {
  const entryId = recorder.startEntry("step", data);
  
  try {
    const result = await fn();
    recorder.endEntry(entryId, { result: "success" });
    return result;
  } catch (error) {
    recorder.failEntry(entryId, String(error));
    throw error;
  }
}
