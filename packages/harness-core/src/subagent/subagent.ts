/**
 * Subagent - 单个子代理实例
 * 
 * 表示一个独立运行的子代理
 */

import { EventEmitter } from "node:events";
import type {
  SubagentConfig,
  SubagentStatus,
  SubagentRole,
  SubagentRun,
  SubagentStep,
  SubagentResult,
  SubagentMessage,
  SubagentIsolation,
} from "./subagent-types.js";

/**
 * 子代理事件
 */
export interface SubagentEvents {
  "status:change": [status: SubagentStatus, previous: SubagentStatus];
  "step": [step: SubagentStep];
  "message": [message: SubagentMessage];
  "completed": [result: SubagentResult];
  "error": [error: Error];
  "progress": [progress: number];
}

/**
 * 子代理实例
 */
export class Subagent extends EventEmitter<SubagentEvents> {
  readonly id: string;
  readonly role: SubagentRole;
  readonly name: string;
  readonly parentId?: string;
  readonly config: SubagentConfig;
  readonly isolation: SubagentIsolation;
  readonly createdAt: number;
  
  private _status: SubagentStatus = "initializing";
  private _run?: SubagentRun;
  private _progress: number = 0;
  private _sessionId: string;
  
  constructor(
    sessionId: string,
    config: SubagentConfig,
    parentId?: string
  ) {
    super();
    
    this.id = config.id || this.generateId(config.role);
    this.role = config.role;
    this.name = config.name || config.role;
    this.config = config;
    this.parentId = parentId;
    this._sessionId = sessionId;
    this.isolation = config.isolation || "shared";
    this.createdAt = Date.now();
    
    // Initialize run
    this._run = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      subagentId: this.id,
      sessionId: sessionId,
      parentRunId: parentId,
      status: "initializing",
      startedAt: Date.now(),
      steps: [],
    };
  }
  
  // ============================================================================
  // Public Methods
  // ============================================================================
  
  /**
   * 获取会话 ID
   */
  getSessionId(): string {
    return this._sessionId;
  }
  
  /**
   * 获取状态
   */
  getStatus(): SubagentStatus {
    return this._status;
  }
  
  /**
   * 获取运行信息
   */
  getRun(): SubagentRun {
    return this._run!;
  }
  
  /**
   * 获取进度
   */
  getProgress(): number {
    return this._progress;
  }
  
  /**
   * 设置进度
   */
  setProgress(progress: number): void {
    this._progress = Math.max(0, Math.min(100, progress));
    this.emit("progress", this._progress);
  }
  
  /**
   * 设置状态
   */
  setStatus(newStatus: SubagentStatus): void {
    const previous = this._status;
    this._status = newStatus;
    
    if (this._run) {
      this._run.status = newStatus;
      
      if (newStatus === "completed" || newStatus === "failed" || newStatus === "cancelled") {
        this._run.endedAt = Date.now();
        this._run.duration = this._run.endedAt - this._run.startedAt;
        this._run.progress = 100;
        this._progress = 100;
      }
    }
    
    this.emit("status:change", newStatus, previous);
  }
  
  /**
   * 添加步骤
   */
  addStep(step: Omit<SubagentStep, "id">): void {
    const fullStep: SubagentStep = {
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      ...step,
    };
    
    if (this._run) {
      this._run.steps.push(fullStep);
    }
    
    this.emit("step", fullStep);
  }
  
  /**
   * 发送消息
   */
  send(message: SubagentMessage): void {
    this.emit("message", message);
  }
  
  /**
   * 完成
   */
  complete(result: SubagentResult): void {
    if (this._run) {
      this._run.result = result;
    }
    this.setStatus(result.success ? "completed" : "failed");
    this.emit("completed", result);
  }
  
  /**
   * 暂停
   */
  pause(): void {
    if (this._status === "running") {
      this.setStatus("paused");
    }
  }
  
  /**
   * 恢复
   */
  resume(): void {
    if (this._status === "paused") {
      this.setStatus("running");
    }
  }
  
  /**
   * 取消
   */
  cancel(): void {
    if (this._status === "running" || this._status === "ready") {
      this.setStatus("cancelled");
    }
  }
  
  /**
   * 添加 token 使用
   */
  addTokens(input: number, output: number): void {
    if (this._run) {
      this._run.tokensUsed = {
        input: (this._run.tokensUsed?.input || 0) + input,
        output: (this._run.tokensUsed?.output || 0) + output,
      };
    }
  }
  
  /**
   * 获取完整状态
   */
  getInfo(): {
    id: string;
    role: SubagentRole;
    name: string;
    status: SubagentStatus;
    progress: number;
    parentId?: string;
    isolation: SubagentIsolation;
    createdAt: number;
    duration?: number;
    stepsCount: number;
    tokensUsed: { input: number; output: number };
  } {
    return {
      id: this.id,
      role: this.role,
      name: this.name,
      status: this._status,
      progress: this._progress,
      parentId: this.parentId,
      isolation: this.isolation,
      createdAt: this.createdAt,
      duration: this._run?.duration,
      stepsCount: this._run?.steps.length || 0,
      tokensUsed: {
        input: this._run?.tokensUsed?.input || 0,
        output: this._run?.tokensUsed?.output || 0,
      },
    };
  }
  
  // ============================================================================
  // Private Methods
  // ============================================================================
  
  private generateId(role: SubagentRole): string {
    return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

/**
 * 创建子代理
 */
export function createSubagent(
  sessionId: string,
  config: SubagentConfig,
  parentId?: string
): Subagent {
  return new Subagent(sessionId, config, parentId);
}
