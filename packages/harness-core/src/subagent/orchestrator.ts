/**
 * Orchestrator - 编排器
 * 
 * 提供多代理编排能力:
 * - Sequential: 顺序执行
 * - Parallel: 并行执行
 * - Pipeline: 流水线
 * - Fan-out: 分发-收集
 */

import type { SubagentManager } from "./subagent-manager.js";
import type { Subagent, SubagentEvents } from "./subagent.js";
import type {
  Orchestration,
  OrchestrationTask,
  OrchestrationMode,
  OrchestrationResult,
  SubagentConfig,
  SubagentResult,
} from "./subagent-types.js";
import { OrchestrationError } from "./subagent-types.js";

/**
 * 编排器
 */
export class Orchestrator {
  constructor(private manager: SubagentManager) {}
  
  /**
   * 执行编排
   */
  async execute(orchestration: Orchestration): Promise<OrchestrationResult> {
    const startTime = Date.now();
    
    const taskResults: Record<string, SubagentResult> = {};
    const completedTasks: string[] = [];
    const failedTasks: string[] = [];
    
    try {
      // Validate orchestration
      this.validateOrchestration(orchestration);
      
      let success = false;
      let output: Record<string, unknown> | undefined;
      
      // Execute based on mode
      switch (orchestration.mode) {
        case "sequential":
          ({ success, output } = await this.executeSequential(
            orchestration,
            taskResults,
            completedTasks,
            failedTasks,
          ));
          break;
          
        case "parallel":
          ({ success, output } = await this.executeParallel(
            orchestration,
            taskResults,
            completedTasks,
            failedTasks,
          ));
          break;
          
        case "pipeline":
          ({ success, output } = await this.executePipeline(
            orchestration,
            taskResults,
            completedTasks,
            failedTasks,
          ));
          break;
          
        case "fan-out":
          ({ success, output } = await this.executeFanOut(
            orchestration,
            taskResults,
            completedTasks,
            failedTasks,
          ));
          break;
          
        default:
          throw new OrchestrationError(
            orchestration.id,
            `Unknown orchestration mode: ${orchestration.mode}`
          );
      }
      
      return {
        orchestrationId: orchestration.id,
        success,
        taskResults,
        completedTasks,
        failedTasks,
        duration: Date.now() - startTime,
        output,
      };
    } catch (error) {
      throw new OrchestrationError(
        orchestration.id,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  
  /**
   * 顺序执行
   */
  private async executeSequential(
    orchestration: Orchestration,
    taskResults: Record<string, SubagentResult>,
    completedTasks: string[],
    failedTasks: string[],
  ): Promise<{ success: boolean; output?: Record<string, unknown> }> {
    // Resolve execution order based on dependencies
    const orderedTasks = this.topologicalSort(orchestration.tasks);
    
    const context: Record<string, unknown> = { ...orchestration.context };
    
    for (const task of orderedTasks) {
      const result = await this.executeTask(
        task,
        context,
        orchestration,
        taskResults,
      );
      
      taskResults[task.id] = result;
      
      if (result.success) {
        completedTasks.push(task.id);
        if (result.data) {
          Object.assign(context, result.data);
        }
      } else {
        failedTasks.push(task.id);
        if (orchestration.onFailure === "abort") {
          return { success: false };
        }
      }
    }
    
    return {
      success: failedTasks.length === 0,
      output: context,
    };
  }
  
  /**
   * 并行执行
   */
  private async executeParallel(
    orchestration: Orchestration,
    taskResults: Record<string, SubagentResult>,
    completedTasks: string[],
    failedTasks: string[],
  ): Promise<{ success: boolean; output?: Record<string, unknown> }> {
    const promises = orchestration.tasks.map((task) =>
      this.executeTask(task, orchestration.context || {}, orchestration, taskResults)
    );
    
    const results = await Promise.allSettled(promises);
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const task = orchestration.tasks[i];
      
      if (result.status === "fulfilled") {
        taskResults[task.id] = result.value;
        if (result.value.success) {
          completedTasks.push(task.id);
        } else {
          failedTasks.push(task.id);
        }
      } else {
        taskResults[task.id] = {
          success: false,
          error: result.reason?.message || "Unknown error",
          duration: 0,
        };
        failedTasks.push(task.id);
      }
    }
    
    const output: Record<string, unknown> = {};
    for (const taskId of completedTasks) {
      output[taskId] = taskResults[taskId].data;
    }
    
    return {
      success: failedTasks.length === 0,
      output,
    };
  }
  
  /**
   * 流水线执行
   */
  private async executePipeline(
    orchestration: Orchestration,
    taskResults: Record<string, SubagentResult>,
    completedTasks: string[],
    failedTasks: string[],
  ): Promise<{ success: boolean; output?: Record<string, unknown> }> {
    // Pipeline = sequential with strict data flow
    return this.executeSequential(orchestration, taskResults, completedTasks, failedTasks);
  }
  
  /**
   * Fan-out 执行
   */
  private async executeFanOut(
    orchestration: Orchestration,
    taskResults: Record<string, SubagentResult>,
    completedTasks: string[],
    failedTasks: string[],
  ): Promise<{ success: boolean; output?: Record<string, unknown> }> {
    // Fan out all tasks, collect results
    const promises = orchestration.tasks.map((task) =>
      this.executeTask(task, orchestration.context || {}, orchestration, taskResults)
    );
    
    const results = await Promise.allSettled(promises);
    
    const outputs: unknown[] = [];
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const task = orchestration.tasks[i];
      
      if (result.status === "fulfilled") {
        taskResults[task.id] = result.value;
        if (result.value.success) {
          completedTasks.push(task.id);
          outputs.push(result.value.data);
        } else {
          failedTasks.push(task.id);
        }
      } else {
        taskResults[task.id] = {
          success: false,
          error: result.reason?.message || "Unknown error",
          duration: 0,
        };
        failedTasks.push(task.id);
      }
    }
    
    return {
      success: failedTasks.length === 0,
      output: { results: outputs },
    };
  }
  
  /**
   * 执行单个任务
   */
  private async executeTask(
    task: OrchestrationTask,
    context: Record<string, unknown>,
    orchestration: Orchestration,
    taskResults: Record<string, SubagentResult>,
  ): Promise<SubagentResult> {
    const startTime = Date.now();
    
    // Merge context with task input
    const taskContext = {
      ...context,
      ...(task.input || {}),
    };
    
    // Update subagent config
    const subagentConfig: SubagentConfig = {
      ...task.subagent,
      context: taskContext,
    };
    
    // Spawn subagent
    const sessionId = task.subagent.context?.__sessionId as string || "default";
    const subagent = this.manager.spawn(sessionId, subagentConfig);
    
    // Set to running
    subagent.setStatus("running");
    
    try {
      // Set up timeout
      const timeoutMs = task.subagent.timeout || orchestration.timeout || 300000;
      
      // Execute task (mock implementation - real one would call LLM)
      const result = await this.runTask(subagent, task, timeoutMs);
      
      // Record steps
      subagent.addStep({
        type: "completed",
        input: task.input,
        output: result.data,
        startedAt: startTime,
        endedAt: Date.now(),
      });
      
      subagent.complete(result);
      
      return result;
    } catch (error) {
      const errorResult: SubagentResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
      
      subagent.complete(errorResult);
      
      return errorResult;
    }
  }
  
  /**
   * 运行任务 (简化的任务执行)
   */
  private async runTask(
    subagent: Subagent,
    task: OrchestrationTask,
    timeoutMs: number,
  ): Promise<SubagentResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const timer = setTimeout(() => {
        resolve({
          success: false,
          error: `Task timeout after ${timeoutMs}ms`,
          duration: Date.now() - startTime,
        });
      }, timeoutMs);
      
      // Mock execution (in real impl, would call LLM)
      // Listen for subagent completion
      const onCompleted = (result: SubagentResult) => {
        clearTimeout(timer);
        resolve(result);
      };
      
      subagent.once("completed", onCompleted);
      
      // In a real implementation, we would start the LLM call here
      // For now, simulate completion
      setImmediate(() => {
        const result: SubagentResult = {
          success: true,
          data: {
            taskId: task.id,
            name: task.name,
            output: `[Simulated] Output for task: ${task.name}`,
          },
          duration: Date.now() - startTime,
          summary: `Completed task: ${task.name}`,
        };
        
        subagent.complete(result);
      });
    });
  }
  
  /**
   * 验证编排
   */
  private validateOrchestration(orchestration: Orchestration): void {
    if (!orchestration.id) {
      throw new Error("Orchestration must have an ID");
    }
    if (!orchestration.tasks || orchestration.tasks.length === 0) {
      throw new Error("Orchestration must have at least one task");
    }
    
    // Check for circular dependencies
    const seen = new Set<string>();
    const stack = new Set<string>();
    
    const visit = (taskId: string, path: string[]): void => {
      if (stack.has(taskId)) {
        throw new Error(`Circular dependency detected: ${path.join(" -> ")} -> ${taskId}`);
      }
      if (seen.has(taskId)) return;
      
      stack.add(taskId);
      
      const task = orchestration.tasks.find((t) => t.id === taskId);
      if (task?.dependsOn) {
        for (const dep of task.dependsOn) {
          visit(dep, [...path, taskId]);
        }
      }
      
      stack.delete(taskId);
      seen.add(taskId);
    };
    
    for (const task of orchestration.tasks) {
      visit(task.id, []);
    }
  }
  
  /**
   * 拓扑排序
   */
  private topologicalSort(tasks: OrchestrationTask[]): OrchestrationTask[] {
    const result: OrchestrationTask[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    
    const visit = (task: OrchestrationTask) => {
      if (visited.has(task.id)) return;
      if (visiting.has(task.id)) {
        throw new Error("Circular dependency detected");
      }
      
      visiting.add(task.id);
      
      if (task.dependsOn) {
        for (const depId of task.dependsOn) {
          const dep = tasks.find((t) => t.id === depId);
          if (dep) visit(dep);
        }
      }
      
      visiting.delete(task.id);
      visited.add(task.id);
      result.push(task);
    };
    
    for (const task of tasks) {
      visit(task);
    }
    
    return result;
  }
}

/**
 * 创建编排器
 */
export function createOrchestrator(manager: SubagentManager): Orchestrator {
  return new Orchestrator(manager);
}
