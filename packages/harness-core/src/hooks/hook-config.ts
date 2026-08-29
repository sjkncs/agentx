/**
 * Hook 配置加载器
 * 
 * 支持从文件或环境变量加载Hook配置
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import {
  HookConfig,
  HookDefinition,
  HOOK_EVENTS,
  HookEvent,
} from "./hook-types.js";
import { z } from "zod";

/**
 * Hook配置文件Schema
 */
export const HookConfigFileSchema = z.object({
  version: z.string().optional().default("1.0"),
  hooks: z.array(z.object({
    name: z.string().min(1).max(64),
    description: z.string().max(256).optional(),
    events: z.array(z.string()).min(1),
    action: z.object({
      type: z.enum(["shell", "http", "mcp", "prompt"]),
      command: z.string().optional(),
      url: z.string().optional(),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).optional(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.unknown().optional(),
      server: z.string().optional(),
      tool: z.string().optional(),
      args: z.record(z.string(), z.unknown()).optional(),
      template: z.string().optional(),
      inject: z.record(z.string(), z.string()).optional(),
      timeout: z.number().positive().optional(),
      cwd: z.string().optional(),
    }),
    filter: z.object({
      toolName: z.union([z.string(), z.array(z.string())]).optional(),
      toolPattern: z.string().optional(),
      filePattern: z.string().optional(),
      errorType: z.string().optional(),
      phase: z.string().optional(),
    }).optional(),
    order: z.number().int().optional(),
    enabled: z.boolean().optional(),
    timeout: z.number().positive().optional(),
  })),
  defaults: z.object({
    timeout: z.number().positive().optional(),
    enabled: z.boolean().optional(),
  }).optional(),
});

/**
 * 加载Hook配置
 */
export function loadHookConfig(configPath: string): HookConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Hook config file not found: ${configPath}`);
  }
  
  const content = readFileSync(configPath, "utf-8");
  const parsed = JSON.parse(content);
  
  // 验证并转换事件字符串
  const hooks: HookDefinition[] = [];
  
  for (const hook of parsed.hooks || []) {
    // 验证事件
    const validEvents: HookEvent[] = [];
    for (const eventStr of hook.events) {
      if (!HOOK_EVENTS.includes(eventStr as HookEvent)) {
        console.warn(`Invalid event "${eventStr}" in hook "${hook.name}", skipping`);
        continue;
      }
      validEvents.push(eventStr as HookEvent);
    }
    
    if (validEvents.length === 0) {
      console.warn(`Hook "${hook.name}" has no valid events, skipping`);
      continue;
    }
    
    // 构建Hook定义
    hooks.push({
      name: hook.name,
      description: hook.description,
      events: validEvents,
      action: {
        type: hook.action.type,
        ...(hook.action.command && { command: hook.action.command }),
        ...(hook.action.url && { url: hook.action.url }),
        ...(hook.action.method && { method: hook.action.method }),
        ...(hook.action.headers && { headers: hook.action.headers }),
        ...(hook.action.body && { body: hook.action.body }),
        ...(hook.action.server && { server: hook.action.server }),
        ...(hook.action.tool && { tool: hook.action.tool }),
        ...(hook.action.args && { args: hook.action.args }),
        ...(hook.action.template && { template: hook.action.template }),
        ...(hook.action.inject && { inject: hook.action.inject }),
        ...(hook.action.timeout && { timeout: hook.action.timeout }),
        ...(hook.action.cwd && { cwd: hook.action.cwd }),
      },
      filter: hook.filter,
      order: hook.order ?? 0,
      enabled: hook.enabled ?? true,
      timeout: hook.timeout ?? 60000,
    });
  }
  
  return {
    hooks,
    defaults: parsed.defaults,
  };
}

/**
 * 查找Hook配置文件
 */
export function findHookConfig(searchPaths?: string[]): string | null {
  const defaultPaths = [
    ".agentx/hooks.json",
    ".agentx/hooks.config.json",
    "hooks.json",
    "hooks.config.json",
    ".hooks.json",
  ];
  
  const pathsToCheck = searchPaths || defaultPaths;
  
  for (const configPath of pathsToCheck) {
    const fullPath = resolve(process.cwd(), configPath);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  
  return null;
}

/**
 * 从环境变量加载Hook配置
 */
export function loadHookConfigFromEnv(): HookConfig | null {
  const envConfig = process.env.AGENTX_HOOKS_CONFIG;
  
  if (!envConfig) {
    return null;
  }
  
  try {
    // 如果是JSON字符串
    if (envConfig.startsWith("{")) {
      return JSON.parse(envConfig) as HookConfig;
    }
    
    // 如果是文件路径
    if (existsSync(envConfig)) {
      return loadHookConfig(envConfig);
    }
    
    console.warn(`Hook config env var references non-existent path: ${envConfig}`);
    return null;
  } catch (error) {
    console.error("Failed to parse hook config from env:", error);
    return null;
  }
}

/**
 * 创建默认Hook配置
 */
export function createDefaultHookConfig(): HookConfig {
  return {
    hooks: [],
    defaults: {
      timeout: 60000,
      enabled: true,
    },
  };
}

/**
 * Hook配置示例
 */
export const HOOK_CONFIG_EXAMPLE: HookConfig = {
  hooks: [
    {
      name: "lint-on-write",
      description: "Run ESLint after writing files",
      events: ["tool.post-execute"],
      filter: {
        toolName: "write_file",
      },
      action: {
        type: "shell",
        command: "npx eslint --fix",
        args: ["{{filePath}}"],
        timeout: 30000,
      },
      enabled: true,
    },
    {
      name: "test-after-edit",
      description: "Run tests after editing files",
      events: ["tool.post-execute"],
      filter: {
        toolName: "edit_file",
      },
      action: {
        type: "shell",
        command: "npm test",
        timeout: 60000,
      },
      enabled: true,
    },
    {
      name: "security-check",
      description: "Check for security issues before shell commands",
      events: ["tool.pre-execute"],
      filter: {
        toolName: ["execute_command", "shell", "exec"],
      },
      action: {
        type: "shell",
        command: "python scripts/security_scan.py",
        args: ["{{toolInput}}"],
        timeout: 10000,
      },
      enabled: false,
    },
    {
      name: "notify-on-error",
      description: "Send notification when tool execution fails",
      events: ["tool.error"],
      action: {
        type: "http",
        url: "https://hooks.example.com/notify",
        method: "POST",
        body: {
          event: "tool_error",
          tool: "{{toolName}}",
          error: "{{error}}",
          sessionId: "{{sessionId}}",
        },
        timeout: 5000,
      },
      enabled: false,
    },
    {
      name: "context-log",
      description: "Log context changes",
      events: ["context.inject", "context.compact"],
      action: {
        type: "prompt",
        template: "[Context {{event}} for session {{sessionId}}]",
      },
      enabled: false,
    },
  ],
  defaults: {
    timeout: 60000,
    enabled: true,
  },
};
