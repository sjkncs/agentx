/**
 * Gate Manager - 门控管理器
 * 
 * 管理门控执行:
 * - 注册门控
 * - 执行单个门控
 * - 执行门控管道
 * - 重试逻辑
 * - 并行执行
 * - 统计
 */

import { EventEmitter } from "node:events";
import type {
  GateConfig,
  GateContext,
  GateResult,
  GateStatus,
  GateExecutor,
  GateType,
  GatePipeline,
  PipelineResult,
  GateManagerConfig,
  GateStatistics,
  CompositeGateConfig,
} from "./gate-types.js";
import {
  GateExecutionError,
  GateTimeoutError,
} from "./gate-types.js";
import {
  builtInExecutors,
  executeCompositeGate,
} from "./built-in-gates.js";

/**
 * 门控事件
 */
export interface GateManagerEvents {
  "gate:registered": [config: GateConfig];
  "gate:start": [gateId: string];
  "gate:end": [result: GateResult];
  "pipeline:start": [pipeline: GatePipeline];
  "pipeline:end": [result: PipelineResult];
  "error": [error: Error];
}

/**
 * 门控管理器
 */
export class GateManager extends EventEmitter<GateManagerEvents> {
  private executors: Map<string, GateExecutor> = new Map();
  private history: GateResult[] = [];
  readonly maxConcurrent: number;
  readonly defaultTimeout: number;
  readonly defaultRetries: number;
  readonly stopOnFailure: boolean;
  readonly defaultWorkdir?: string;
  
  constructor(config: GateManagerConfig = {}) {
    super();
    this.maxConcurrent = config.maxConcurrent || 5;
    this.defaultTimeout = config.defaultTimeout || 60000;
    this.defaultRetries = config.defaultRetries || 0;
    this.stopOnFailure = config.stopOnFailure ?? true;
    this.defaultWorkdir = config.defaultWorkdir;
    
    // Register built-in executors
    for (const [type, executor] of builtInExecutors) {
      this.executors.set(type, executor);
    }
  }
  
  // ============================================================================
  // Registration
  // ============================================================================
  
  /**
   * 注册门控执行器
   */
  register(type: GateType | string, executor: GateExecutor): void {
    this.executors.set(type, executor);
  }
  
  /**
   * 注销门控执行器
   */
  unregister(type: string): boolean {
    return this.executors.delete(type);
  }
  
  /**
   * 获取所有支持的类型
   */
  getSupportedTypes(): string[] {
    return Array.from(this.executors.keys());
  }
  
  // ============================================================================
  // Single Gate Execution
  // ============================================================================
  
  /**
   * 执行单个门控
   */
  async executeGate(
    config: GateConfig,
    context: GateContext,
  ): Promise<GateResult> {
    const gateId = config.id || `${config.type}-${Date.now()}`;
    const executor = this.executors.get(config.type);
    
    if (!executor) {
      throw new GateExecutionError(gateId, `No executor for type: ${config.type}`);
    }
    
    // Check skip condition
    if (config.skipIf) {
      const shouldSkip = await config.skipIf(context);
      if (shouldSkip) {
        const result: GateResult = {
          gateId,
          gateName: config.name,
          gateType: config.type,
          status: "skipped",
          passed: true,
          message: "Skipped by condition",
          issues: [],
          duration: 0,
          startedAt: Date.now(),
          endedAt: Date.now(),
        };
        this.history.push(result);
        this.emit("gate:end", result);
        return result;
      }
    }
    
    this.emit("gate:start", gateId);
    
    // Retry logic
    const maxRetries = config.retries ?? this.defaultRetries;
    const retryDelay = config.retryDelay || 1000;
    
    let lastResult: GateResult | null = null;
    let attempt = 0;
    
    while (attempt <= maxRetries) {
      try {
        const result = await executor(config, context);
        result.retries = attempt;
        lastResult = result;
        
        if (result.passed) break;
        if (!config.required) break; // Don't retry non-required gates
        
        attempt++;
        if (attempt <= maxRetries) {
          await new Promise(r => setTimeout(r, retryDelay));
        }
      } catch (err) {
        lastResult = {
          gateId,
          gateName: config.name,
          gateType: config.type,
          status: "error",
          passed: false,
          message: `Error: ${err instanceof Error ? err.message : String(err)}`,
          issues: [],
          duration: 0,
          startedAt: Date.now(),
          endedAt: Date.now(),
          error: err instanceof Error ? err.message : String(err),
          retries: attempt,
        };
        
        attempt++;
        if (attempt <= maxRetries) {
          await new Promise(r => setTimeout(r, retryDelay));
        }
      }
    }
    
    const finalResult = lastResult!;
    this.history.push(finalResult);
    this.emit("gate:end", finalResult);
    return finalResult;
  }
  
  // ============================================================================
  // Pipeline Execution
  // ============================================================================
  
  /**
   * 执行门控管道
   */
  async executePipeline(
    pipeline: GatePipeline,
    context: Partial<GateContext> = {},
  ): Promise<PipelineResult> {
    const fullContext: GateContext = {
      workdir: context.workdir || this.defaultWorkdir || process.cwd(),
      files: context.files,
      commit: context.commit,
      env: context.env,
      data: context.data,
    };
    
    this.emit("pipeline:start", pipeline);
    
    const startedAt = Date.now();
    const gateResults: GateResult[] = [];
    const failedGates: string[] = [];
    const skippedGates: string[] = [];
    
    // Execute gates
    if (pipeline.parallel) {
      const promises = pipeline.gates.map(gate => 
        this.executeGate(gate, fullContext)
      );
      
      const results = await Promise.allSettled(promises);
      
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const gateConfig = pipeline.gates[i];
        
        if (result.status === "fulfilled") {
          gateResults.push(result.value);
          if (!result.value.passed && gateConfig.required) {
            failedGates.push(result.value.gateId);
          }
          if (result.value.status === "skipped") {
            skippedGates.push(result.value.gateId);
          }
        } else {
          const errorResult: GateResult = {
            gateId: gateConfig.id || `${gateConfig.type}-${Date.now()}`,
            gateName: gateConfig.name,
            gateType: gateConfig.type,
            status: "error",
            passed: false,
            message: `Pipeline error: ${result.reason}`,
            issues: [],
            duration: 0,
            startedAt: Date.now(),
            endedAt: Date.now(),
            error: String(result.reason),
          };
          gateResults.push(errorResult);
          failedGates.push(errorResult.gateId);
        }
      }
    } else {
      // Sequential
      for (const gateConfig of pipeline.gates) {
        // Add previous results to context
        fullContext.previousResults = [...gateResults];
        
        const result = await this.executeGate(gateConfig, fullContext);
        gateResults.push(result);
        
        if (!result.passed && gateConfig.required) {
          failedGates.push(result.gateId);
          
          if (this.stopOnFailure && !pipeline.continueOnFailure) {
            break;
          }
        }
        
        if (result.status === "skipped") {
          skippedGates.push(result.gateId);
        }
      }
    }
    
    const totalIssues = gateResults.reduce(
      (sum, r) => sum + r.issues.length,
      0,
    );
    
    const result: PipelineResult = {
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      passed: failedGates.length === 0,
      startedAt,
      endedAt: Date.now(),
      duration: Date.now() - startedAt,
      gateResults,
      failedGates,
      skippedGates,
      totalIssues,
    };
    
    this.emit("pipeline:end", result);
    return result;
  }
  
  // ============================================================================
  // History & Statistics
  // ============================================================================
  
  /**
   * 获取历史
   */
  getHistory(): GateResult[] {
    return [...this.history];
  }
  
  /**
   * 获取统计
   */
  getStatistics(): GateStatistics {
    const byType: GateStatistics["byType"] = {} as any;
    let totalDuration = 0;
    let totalRetries = 0;
    
    for (const result of this.history) {
      totalDuration += result.duration;
      totalRetries += result.retries || 0;
      
      if (!byType[result.gateType]) {
        byType[result.gateType] = { passed: 0, failed: 0, skipped: 0 };
      }
      
      if (result.status === "passed") byType[result.gateType].passed++;
      else if (result.status === "failed") byType[result.gateType].failed++;
      else if (result.status === "skipped") byType[result.gateType].skipped++;
    }
    
    return {
      totalGates: this.history.length,
      passed: this.history.filter(r => r.status === "passed").length,
      failed: this.history.filter(r => r.status === "failed").length,
      skipped: this.history.filter(r => r.status === "skipped").length,
      errored: this.history.filter(r => r.status === "error").length,
      byType,
      averageDuration: this.history.length > 0 ? totalDuration / this.history.length : 0,
      totalRetries,
    };
  }
  
  /**
   * 清理历史
   */
  clearHistory(): void {
    this.history = [];
  }
  
  /**
   * 重置
   */
  dispose(): void {
    this.clearHistory();
    this.removeAllListeners();
  }
}

/**
 * 创建门控管理器
 */
export function createGateManager(config?: GateManagerConfig): GateManager {
  return new GateManager(config);
}