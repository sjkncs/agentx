/**
 * Sandbox Manager - 沙箱管理器
 * 
 * 管理多个沙箱实例
 */

import { EventEmitter } from "node:events";
import {
  type Sandbox,
  createSandbox,
} from "./sandbox.js";
import type {
  SandboxConfig,
  SandboxInfo,
  SandboxStatus,
  SandboxManagerConfig,
} from "./sandbox-types.js";

/**
 * 沙箱管理器事件
 */
export interface SandboxManagerEvents {
  "sandbox:created": [sandbox: Sandbox];
  "sandbox:started": [sandbox: Sandbox];
  "sandbox:stopped": [sandbox: Sandbox];
  "sandbox:destroyed": [sandbox: Sandbox];
  "error": [error: Error];
}

/**
 * 沙箱管理器
 */
export class SandboxManager extends EventEmitter<SandboxManagerEvents> {
  readonly maxSandboxes: number;
  readonly defaultLimits?: any;
  readonly defaultPermissions?: any;
  readonly defaultType: any;
  
  private sandboxes: Map<string, Sandbox> = new Map();
  private cleanupTimer?: NodeJS.Timeout;
  
  constructor(config: SandboxManagerConfig = {}) {
    super();
    this.maxSandboxes = config.maxSandboxes || 20;
    this.defaultLimits = config.defaultLimits;
    this.defaultPermissions = config.defaultPermissions;
    this.defaultType = config.defaultType || "vm";
    
    if (config.cleanupInterval) {
      this.cleanupTimer = setInterval(() => this.cleanup(), config.cleanupInterval);
    }
  }
  
  /**
   * 创建沙箱
   */
  create(config: Partial<SandboxConfig> & { type?: any }): Sandbox {
    if (this.sandboxes.size >= this.maxSandboxes) {
      throw new Error(`Maximum sandboxes (${this.maxSandboxes}) reached`);
    }
    
    const fullConfig: SandboxConfig = {
      type: config.type || this.defaultType,
      name: config.name,
      ...config,
      limits: { ...this.defaultLimits, ...(config.limits || {}) },
      permissions: { ...this.defaultPermissions, ...(config.permissions || {}) },
    } as SandboxConfig;
    
    const sandbox = createSandbox(fullConfig);
    
    // Wire events
    sandbox.on("error", (err) => this.emit("error", err));
    sandbox.on("status:change", (newStatus, prevStatus) => {
      if (newStatus === "running") {
        this.emit("sandbox:started", sandbox);
      } else if (newStatus === "stopped") {
        this.emit("sandbox:stopped", sandbox);
      } else if (newStatus === "destroyed") {
        this.emit("sandbox:destroyed", sandbox);
      }
    });
    
    this.sandboxes.set(sandbox.id, sandbox);
    this.emit("sandbox:created", sandbox);
    
    return sandbox;
  }
  
  /**
   * 获取沙箱
   */
  get(id: string): Sandbox | undefined {
    return this.sandboxes.get(id);
  }
  
  /**
   * 获取所有沙箱
   */
  getAll(): Sandbox[] {
    return Array.from(this.sandboxes.values());
  }
  
  /**
   * 按状态获取
   */
  getByStatus(status: SandboxStatus): Sandbox[] {
    return this.getAll().filter(s => s.getStatus() === status);
  }
  
  /**
   * 获取运行中的沙箱
   */
  getRunning(): Sandbox[] {
    return this.getByStatus("running");
  }
  
  /**
   * 启动沙箱
   */
  async start(id: string): Promise<void> {
    const sandbox = this.get(id);
    if (!sandbox) throw new Error(`Sandbox ${id} not found`);
    await sandbox.start();
  }
  
  /**
   * 停止沙箱
   */
  async stop(id: string): Promise<void> {
    const sandbox = this.get(id);
    if (!sandbox) throw new Error(`Sandbox ${id} not found`);
    await sandbox.stop();
  }
  
  /**
   * 销毁沙箱
   */
  async destroy(id: string): Promise<void> {
    const sandbox = this.get(id);
    if (!sandbox) return;
    await sandbox.destroy();
    this.sandboxes.delete(id);
  }
  
  /**
   * 清理已停止的沙箱
   */
  cleanup(): number {
    let count = 0;
    for (const sandbox of this.sandboxes.values()) {
      const status = sandbox.getStatus();
      if (status === "stopped" || status === "error" || status === "destroyed") {
        this.sandboxes.delete(sandbox.id);
        count++;
      }
    }
    return count;
  }
  
  /**
   * 获取统计
   */
  getStats(): {
    total: number;
    byStatus: Record<SandboxStatus, number>;
    byType: Record<string, number>;
  } {
    const byStatus: Record<SandboxStatus, number> = {
      created: 0,
      starting: 0,
      running: 0,
      stopped: 0,
      paused: 0,
      error: 0,
      destroyed: 0,
    };
    const byType: Record<string, number> = {};
    
    for (const sandbox of this.sandboxes.values()) {
      byStatus[sandbox.getStatus()]++;
      byType[sandbox.type] = (byType[sandbox.type] || 0) + 1;
    }
    
    return {
      total: this.sandboxes.size,
      byStatus,
      byType,
    };
  }
  
  /**
   * 销毁所有
   */
  async dispose(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    const promises = Array.from(this.sandboxes.keys()).map(id => this.destroy(id));
    await Promise.all(promises);
    
    this.sandboxes.clear();
  }
}

/**
 * 创建沙箱管理器
 */
export function createSandboxManager(config?: SandboxManagerConfig): SandboxManager {
  return new SandboxManager(config);
}