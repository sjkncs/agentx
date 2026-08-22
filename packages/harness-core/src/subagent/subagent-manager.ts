/**
 * Subagent Manager - 子代理管理器
 * 
 * 管理子代理的:
 * - 创建、删除
 * - Fork、Resume、暂停、恢复
 * - 消息传递
 * - 统计
 */

import { EventEmitter } from "node:events";
import type {
  Subagent,
  SubagentEvents,
} from "./subagent.js";
import { createSubagent } from "./subagent.js";
import type {
  SubagentConfig,
  SubagentStatus,
  SubagentRole,
  SubagentRun,
  SubagentResult,
  SubagentMessage,
  MessageType,
  SubagentManagerConfig,
  SubagentStats,
  SubagentIsolation,
} from "./subagent-types.js";
import {
  SubagentSpawnError,
  SubagentNotFoundError,
} from "./subagent-types.js";

/**
 * 消息监听器
 */
interface MessageListener {
  id: string;
  messageType?: MessageType;
  subject?: string;
  handler: (message: SubagentMessage) => void | Promise<void>;
}

/**
 * 子代理管理器事件
 */
export interface SubagentManagerEvents {
  "subagent:spawned": [subagent: Subagent];
  "subagent:completed": [subagent: Subagent, result: SubagentResult];
  "subagent:removed": [subagentId: string];
  "message": [message: SubagentMessage];
}

/**
 * 子代理管理器
 */
export class SubagentManager extends EventEmitter<SubagentManagerEvents> {
  private subagents: Map<string, Subagent> = new Map();
  private subagentsByParent: Map<string, Set<string>> = new Map();
  private messages: SubagentMessage[] = [];
  private messageListeners: Map<string, MessageListener> = new Map();
  private stats: SubagentStats;
  
  readonly maxConcurrent: number;
  readonly defaultTimeout: number;
  readonly autoCleanup: boolean;
  readonly historyRetentionMs: number;
  readonly defaultIsolation: SubagentIsolation;
  
  constructor(config: SubagentManagerConfig = {}) {
    super();
    
    this.maxConcurrent = config.maxConcurrent || 10;
    this.defaultTimeout = config.defaultTimeout || 60000;
    this.autoCleanup = config.autoCleanup ?? true;
    this.historyRetentionMs = config.historyRetentionMs || 3600000; // 1 hour
    this.defaultIsolation = config.defaultIsolation || "shared";
    
    this.stats = {
      totalSpawned: 0,
      currentlyRunning: 0,
      completed: 0,
      failed: 0,
      byRole: {},
      totalDuration: 0,
      averageDuration: 0,
      totalTokensUsed: 0,
    };
  }
  
  // ============================================================================
  // Subagent Lifecycle
  // ============================================================================
  
  /**
   * 创建子代理
   */
  spawn(sessionId: string, config: SubagentConfig, parentId?: string): Subagent {
    // Check concurrent limit - count all active subagents
    const activeCount = this.getActive().length;
    if (activeCount >= this.maxConcurrent) {
      throw new SubagentSpawnError(
        config.id || config.role,
        `Maximum concurrent subagents (${this.maxConcurrent}) reached`
      );
    }
    
    const subagent = createSubagent(sessionId, config, parentId);
    
    // Track subagent
    this.subagents.set(subagent.id, subagent);
    
    // Track by parent
    if (parentId) {
      if (!this.subagentsByParent.has(parentId)) {
        this.subagentsByParent.set(parentId, new Set());
      }
      this.subagentsByParent.get(parentId)!.add(subagent.id);
    }
    
    // Wire up subagent events
    this.wireSubagentEvents(subagent);
    
    // Update stats
    this.stats.totalSpawned++;
    this.stats.byRole[subagent.role] = (this.stats.byRole[subagent.role] || 0) + 1;
    
    // Initialize
    subagent.setStatus("ready");
    
    this.emit("subagent:spawned", subagent);
    
    return subagent;
  }
  
  /**
   * Fork 子代理（从父代理的上下文创建）
   */
  fork(
    sessionId: string,
    parentId: string,
    config: Omit<SubagentConfig, "forkFromSessionId">
  ): Subagent {
    const parent = this.get(parentId);
    if (!parent) {
      throw new SubagentNotFoundError(parentId);
    }
    
    const forkConfig: SubagentConfig = {
      ...config,
      forkFromSessionId: parent.getSessionId(),
      isolation: "fork",
    };
    
    return this.spawn(sessionId, forkConfig, parentId);
  }
  
  /**
   * 恢复子代理
   */
  resume(
    sessionId: string,
    subagentId: string,
    newPrompt?: string
  ): Subagent {
    // Check if already exists
    const existing = this.subagents.get(subagentId);
    if (existing && existing.getStatus() === "paused") {
      if (newPrompt) {
        existing.config.prompt = newPrompt;
      }
      existing.resume();
      return existing;
    }
    
    // Create new subagent resuming from previous
    const previousRuns = this.getRunHistory(subagentId);
    const lastRun = previousRuns[previousRuns.length - 1];
    
    const resumeConfig: SubagentConfig = {
      id: `${subagentId}-resumed-${Date.now()}`,
      role: "worker",
      prompt: newPrompt || lastRun?.result?.summary || "Resume operation",
      resumeFromSubagentId: subagentId,
      isolation: "isolated",
    };
    
    return this.spawn(sessionId, resumeConfig);
  }
  
  /**
   * 移除子代理
   */
  remove(subagentId: string): boolean {
    const subagent = this.subagents.get(subagentId);
    if (!subagent) return false;
    
    // Cancel if running
    if (subagent.getStatus() === "running" || subagent.getStatus() === "ready") {
      subagent.cancel();
    }
    
    // Remove
    this.subagents.delete(subagentId);
    
    // Remove from parent tracking
    for (const [parentId, children] of this.subagentsByParent.entries()) {
      children.delete(subagentId);
      if (children.size === 0) {
        this.subagentsByParent.delete(parentId);
      }
    }
    
    this.emit("subagent:removed", subagentId);
    
    return true;
  }
  
  // ============================================================================
  // Query Methods
  // ============================================================================
  
  /**
   * 获取子代理
   */
  get(subagentId: string): Subagent | undefined {
    return this.subagents.get(subagentId);
  }
  
  /**
   * 获取所有子代理
   */
  getAll(): Subagent[] {
    return Array.from(this.subagents.values());
  }
  
  /**
   * 按角色获取
   */
  getByRole(role: SubagentRole): Subagent[] {
    return this.getAll().filter((s) => s.role === role);
  }
  
  /**
   * 按状态获取
   */
  getByStatus(status: SubagentStatus): Subagent[] {
    return this.getAll().filter((s) => s.getStatus() === status);
  }
  
  /**
   * 获取运行中的子代理
   */
  getRunning(): Subagent[] {
    return this.getByStatus("running");
  }

  /**
   * 获取所有活跃的子代理（运行中或就绪）
   */
  getActive(): Subagent[] {
    return this.getAll().filter((s) => {
      const status = s.getStatus();
      return status === "running" || status === "ready" || status === "paused";
    });
  }
  
  /**
   * 获取父代理的子代理
   */
  getChildren(parentId: string): Subagent[] {
    const childIds = this.subagentsByParent.get(parentId) || new Set();
    return Array.from(childIds)
      .map((id) => this.subagents.get(id))
      .filter((s): s is Subagent => s !== undefined);
  }
  
  /**
   * 获取运行历史
   */
  getRunHistory(subagentId: string): SubagentRun[] {
    // In a real implementation, this would query persistent storage
    // For now, just return current run
    const subagent = this.get(subagentId);
    return subagent ? [subagent.getRun()] : [];
  }
  
  // ============================================================================
  // Messaging
  // ============================================================================
  
  /**
   * 发送消息
   */
  sendMessage(message: SubagentMessage): void {
    this.messages.push(message);
    this.emit("message", message);
    
    // Invoke registered listeners
    for (const listener of this.messageListeners.values()) {
      // Filter by messageType if specified
      if (listener.messageType && message.type !== listener.messageType) {
        continue;
      }
      // Filter by subject if specified
      if (listener.subject && message.subject !== listener.subject) {
        continue;
      }
      
      try {
        const result = listener.handler(message);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error("Message listener error:", err);
          });
        }
      } catch (err) {
        console.error("Message listener error:", err);
      }
    }
    
    // Trim old messages if needed
    if (this.messages.length > 1000) {
      this.messages = this.messages.slice(-500);
    }
  }
  
  /**
   * 注册消息监听器
   */
  onMessage(
    handler: (message: SubagentMessage) => void | Promise<void>,
    options?: { messageType?: MessageType; subject?: string }
  ): () => void {
    const id = `listener-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    
    this.messageListeners.set(id, {
      id,
      handler,
      messageType: options?.messageType,
      subject: options?.subject,
    });
    
    return () => this.messageListeners.delete(id);
  }
  
  /**
   * 获取消息历史
   */
  getMessages(): SubagentMessage[] {
    return [...this.messages];
  }
  
  // ============================================================================
  // Statistics
  // ============================================================================
  
  /**
   * 获取统计
   */
  getStats(): SubagentStats {
    return {
      ...this.stats,
      currentlyRunning: this.getRunning().length,
    };
  }
  
  /**
   * 获取详细统计
   */
  getDetailedStats(): {
    total: number;
    byRole: Record<string, number>;
    byStatus: Record<SubagentStatus, number>;
    byIsolation: Record<SubagentIsolation, number>;
  } {
    const byRole: Record<string, number> = {};
    const byStatus: Record<SubagentStatus, number> = {} as Record<SubagentStatus, number>;
    const byIsolation: Record<SubagentIsolation, number> = {
      shared: 0,
      fork: 0,
      isolated: 0,
      sandboxed: 0,
    };
    
    for (const subagent of this.subagents.values()) {
      byRole[subagent.role] = (byRole[subagent.role] || 0) + 1;
      
      const status = subagent.getStatus();
      byStatus[status] = (byStatus[status] || 0) + 1;
      
      byIsolation[subagent.isolation] = (byIsolation[subagent.isolation] || 0) + 1;
    }
    
    return {
      total: this.subagents.size,
      byRole,
      byStatus,
      byIsolation,
    };
  }
  
  /**
   * 清理
   */
  async dispose(): Promise<void> {
    // Cancel all running subagents
    for (const subagent of this.subagents.values()) {
      if (subagent.getStatus() === "running" || subagent.getStatus() === "ready") {
        subagent.cancel();
      }
    }
    
    this.subagents.clear();
    this.subagentsByParent.clear();
    this.messages = [];
    this.messageListeners.clear();
  }
  
  // ============================================================================
  // Private Methods
  // ============================================================================
  
  private wireSubagentEvents(subagent: Subagent): void {
    subagent.on("status:change", (newStatus, previous) => {
      if (newStatus === "completed") {
        this.stats.completed++;
      } else if (newStatus === "failed") {
        this.stats.failed++;
      }
      
      // Update running count
      if (previous === "running" && newStatus !== "running") {
        // Subagent finished running
        this.emit("subagent:completed", subagent, subagent.getRun().result || {
          success: false,
          duration: 0,
          error: "Unknown error",
        });
      }
    });
    
    subagent.on("completed", (result) => {
      if (result.duration) {
        this.stats.totalDuration += result.duration;
        const total = this.stats.completed + this.stats.failed;
        this.stats.averageDuration = this.stats.totalDuration / total;
      }
    });
    
    subagent.on("message", (message) => {
      this.sendMessage(message);
    });
  }
}

/**
 * 创建子代理管理器
 */
export function createSubagentManager(
  config?: SubagentManagerConfig
): SubagentManager {
  return new SubagentManager(config);
}
