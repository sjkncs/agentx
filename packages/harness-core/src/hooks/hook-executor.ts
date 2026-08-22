/**
 * Hook Executor - 执行不同类型的Hook Action
 * 
 * 支持:
 * - Shell 命令执行
 * - HTTP 请求
 * - MCP 工具调用
 * - Prompt 模板
 */

import { exec } from "child_process";
import { promisify } from "util";
import type { ExecException } from "child_process";
import {
  HookAction,
  HookContext,
  HookResult,
  ShellHookAction,
  HttpHookAction,
  McpHookAction,
  PromptHookAction,
} from "./hook-types.js";

const execAsync = promisify(exec);

/**
 * Hook Executor 配置
 */
export interface HookExecutorConfig {
  /** Shell 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 最大并发数 */
  maxConcurrency?: number;
  /** 默认超时时间 */
  defaultTimeout?: number;
  /** MCP 服务器映射 */
  mcpServers?: Record<string, (tool: string, args: unknown) => Promise<unknown>>;
}

/**
 * Hook Executor - 执行Hook Action
 */
export class HookExecutor {
  private activePromises: Set<Promise<unknown>> = new Set();
  
  constructor(private config: HookExecutorConfig = {}) {}
  
  /**
   * 执行Hook Action
   */
  async execute(
    action: HookAction,
    context: HookContext
  ): Promise<HookResult> {
    const startTime = Date.now();
    
    try {
      switch (action.type) {
        case "shell":
          return await this.executeShell(action, context, startTime);
        case "http":
          return await this.executeHttp(action, context, startTime);
        case "mcp":
          return await this.executeMcp(action, context, startTime);
        case "prompt":
          return await this.executePrompt(action, context, startTime);
        default:
          return {
            success: false,
            error: `Unknown action type: ${(action as HookAction).type}`,
            duration: Date.now() - startTime,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * 执行 Shell 命令
   */
  private async executeShell(
    action: ShellHookAction,
    context: HookContext,
    startTime: number
  ): Promise<HookResult> {
    const timeout = action.timeout ?? this.config.defaultTimeout ?? 30000;
    const cwd = action.cwd ?? this.config.cwd ?? process.cwd();
    
    // 替换模板变量
    const command = this.interpolateVariables(action.command, context);
    const args = action.args?.map((arg) => this.interpolateVariables(arg, context)) ?? [];
    
    return new Promise((resolve) => {
      const childProcess = exec(
        args.length > 0 ? `${command} ${args.join(" ")}` : command,
        {
          cwd,
          env: { ...process.env, ...this.config.env },
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        },
        (error: ExecException | null, stdout: string, stderr: string) => {
          if (error) {
            resolve({
              success: false,
              error: stderr || error.message,
              output: stdout,
              duration: Date.now() - startTime,
            });
          } else {
            resolve({
              success: true,
              output: stdout,
              duration: Date.now() - startTime,
            });
          }
        }
      );
      
      // 超时处理
      setTimeout(() => {
        childProcess.kill("SIGTERM");
        resolve({
          success: false,
          error: "Shell command timeout",
          duration: timeout,
        });
      }, timeout);
    });
  }
  
  /**
   * 执行 HTTP 请求
   */
  private async executeHttp(
    action: HttpHookAction,
    context: HookContext,
    startTime: number
  ): Promise<HookResult> {
    const timeout = action.timeout ?? this.config.defaultTimeout ?? 10000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      // 替换模板变量
      const url = this.interpolateVariables(action.url, context);
      const body = action.body ? this.interpolateVariables(JSON.stringify(action.body), context) : undefined;
      
      const response = await fetch(url, {
        method: action.method,
        headers: {
          "Content-Type": "application/json",
          ...action.headers,
        },
        body: body ? JSON.stringify(JSON.parse(body)) : undefined,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      const responseText = await response.text();
      
      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          output: responseText,
          duration: Date.now() - startTime,
        };
      }
      
      return {
        success: true,
        output: responseText,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === "AbortError") {
        return {
          success: false,
          error: "HTTP request timeout",
          duration: timeout,
        };
      }
      
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * 执行 MCP 工具调用
   */
  private async executeMcp(
    action: McpHookAction,
    context: HookContext,
    startTime: number
  ): Promise<HookResult> {
    const mcpServer = this.config.mcpServers?.[action.server];
    
    if (!mcpServer) {
      return {
        success: false,
        error: `MCP server not found: ${action.server}`,
        duration: Date.now() - startTime,
      };
    }
    
    try {
      const args = action.args 
        ? Object.fromEntries(
            Object.entries(action.args).map(([k, v]) => [
              k,
              typeof v === "string" ? this.interpolateVariables(v, context) : v,
            ])
          )
        : {};
      
      const result = await mcpServer(action.tool, args);
      
      return {
        success: true,
        output: typeof result === "string" ? result : JSON.stringify(result),
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * 执行 Prompt 模板
   */
  private async executePrompt(
    action: PromptHookAction,
    context: HookContext,
    startTime: number
  ): Promise<HookResult> {
    try {
      // 替换模板变量
      let output = this.interpolateVariables(action.template, context);
      
      // 应用注入变量
      if (action.inject) {
        for (const [key, value] of Object.entries(action.inject)) {
          const stringValue = String(value);
          output = output.replace(new RegExp(`{{${key}}}`, "g"), stringValue);
        }
      }
      
      return {
        success: true,
        output,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * 替换模板变量
   */
  private interpolateVariables(template: string, context: HookContext): string {
    return template
      .replace(/\{\{sessionId\}\}/g, context.sessionId)
      .replace(/\{\{runId\}\}/g, context.runId)
      .replace(/\{\{turnId\}\}/g, context.turnId || "")
      .replace(/\{\{stepId\}\}/g, context.stepId || "")
      .replace(/\{\{toolName\}\}/g, context.toolName || "")
      .replace(/\{\{toolInput\}\}/g, context.toolInput ? JSON.stringify(context.toolInput) : "")
      .replace(/\{\{toolOutput\}\}/g, context.toolOutput ? JSON.stringify(context.toolOutput) : "")
      .replace(/\{\{error\}\}/g, context.error || "")
      .replace(/\{\{stepIndex\}\}/g, String(context.stepIndex ?? 0))
      .replace(/\{\{agentName\}\}/g, context.agentName || "datafoundry");
  }
  
  /**
   * 等待所有活跃的Hook执行完成
   */
  async waitForCompletion(): Promise<void> {
    await Promise.all(this.activePromises);
  }
  
  /**
   * 取消所有Hook执行
   */
  cancelAll(): void {
    this.activePromises.forEach((p) => {
      // 注意：Promise无法被直接取消，但可以通过信号量机制
    });
    this.activePromises.clear();
  }
}
