/**
 * MCP Bridge - 将 MCP 桥接到 Harness Core
 * 
 * 将 MCP 工具桥接到本地工具注册表
 * 将 MCP 服务器转换为 Harness 服务
 */

import type {
  McpClient,
  McpServer,
} from "./index.js";
import type { ToolDefinition, ToolExecuteFunction, PluginToolContext } from "../plugins/plugin-types.js";

/**
 * 桥接选项
 */
export interface McpBridgeOptions {
  /** 客户端 */
  client: McpClient;
  /** 是否启用 */
  enabled?: boolean;
  /** 命名空间前缀 */
  namespace?: string;
}

/**
 * 将 MCP 工具转换为 Harness 工具
 */
export function mcpToolToHarnessTool(
  serverName: string,
  mcpTool: import("./mcp-types.js").McpTool,
  client: McpClient,
  namespace?: string,
): ToolDefinition {
  const toolName = namespace 
    ? `${namespace}.${mcpTool.name}`
    : `${serverName}.${mcpTool.name}`;
  
  const execute: ToolExecuteFunction = async (input, context) => {
    try {
      const result = await client.callTool(serverName, {
        name: mcpTool.name,
        arguments: input as Record<string, unknown>,
      });
      
      // Extract text content
      const textContent = result.content
        .filter((c) => c.type === "text")
        .map((c) => c.type === "text" ? c.text : "")
        .join("\n");
      
      return {
        content: textContent,
        isError: result.isError,
        raw: result,
      };
    } catch (err) {
      return {
        content: err instanceof Error ? err.message : String(err),
        isError: true,
      };
    }
  };
  
  return {
    name: toolName,
    description: mcpTool.description,
    inputSchema: mcpTool.inputSchema as unknown as import("zod").ZodType<unknown>,
    execute,
  };
}

/**
 * MCP Bridge - 提供将 MCP 桥接到 Harness 的工具
 */
export class McpBridge {
  private options: McpBridgeOptions;
  private bridgedTools: Map<string, ToolDefinition> = new Map();
  
  constructor(options: McpBridgeOptions) {
    this.options = options;
  }
  
  /**
   * 桥接所有 MCP 工具到 Harness
   */
  async bridgeAllTools(): Promise<ToolDefinition[]> {
    if (!this.options.enabled) return [];
    
    const tools: ToolDefinition[] = [];
    const allTools = await this.options.client.listAllTools();
    
    for (const [serverName, serverTools] of Object.entries(allTools)) {
      for (const mcpTool of serverTools) {
        const tool = mcpToolToHarnessTool(
          serverName,
          mcpTool,
          this.options.client,
          this.options.namespace,
        );
        
        this.bridgedTools.set(tool.name, tool);
        tools.push(tool);
      }
    }
    
    return tools;
  }
  
  /**
   * 桥接指定服务器的工具
   */
  async bridgeServerTools(serverName: string): Promise<ToolDefinition[]> {
    if (!this.options.enabled) return [];
    
    const serverTools = await this.options.client.listTools(serverName);
    const tools: ToolDefinition[] = [];
    
    for (const mcpTool of serverTools) {
      const tool = mcpToolToHarnessTool(
        serverName,
        mcpTool,
        this.options.client,
        this.options.namespace,
      );
      
      this.bridgedTools.set(tool.name, tool);
      tools.push(tool);
    }
    
    return tools;
  }
  
  /**
   * 刷新桥接
   */
  async refresh(): Promise<void> {
    this.bridgedTools.clear();
    await this.bridgeAllTools();
  }
  
  /**
   * 获取桥接的工具
   */
  getBridgedTools(): ToolDefinition[] {
    return Array.from(this.bridgedTools.values());
  }
  
  /**
   * 获取桥接的工具 (按名称)
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.bridgedTools.get(name);
  }
  
  /**
   * 检查是否已桥接
   */
  isBridged(name: string): boolean {
    return this.bridgedTools.has(name);
  }
  
  /**
   * 清理
   */
  clear(): void {
    this.bridgedTools.clear();
  }
}

/**
 * 创建 MCP Bridge
 */
export function createMcpBridge(options: McpBridgeOptions): McpBridge {
  return new McpBridge(options);
}

/**
 * 将 Harness 工具转换为 MCP 工具
 */
export function harnessToolToMcpTool(
  name: string,
  description: string,
  inputSchema: any,
): import("./mcp-types.js").McpTool {
  return {
    name,
    description,
    inputSchema: inputSchema as import("./mcp-types.js").McpToolInputSchema,
  };
}

/**
 * 将 Harness Tool Registry 注册到 MCP Server
 */
export function registerHarnessToolsToMcpServer(
  mcpServer: McpServer,
  tools: ToolDefinition[],
): void {
  for (const tool of tools) {
    mcpServer.registerTool(
      tool.name,
      tool.description,
      tool.inputSchema as any,
      async (params: unknown) => {
        try {
          const result = await tool.execute(params as Record<string, unknown>, {
            sessionId: '',
            runId: '',
            toolName: tool.name,
            userServices: {},
          } as PluginToolContext);
          
          return {
            content: [
              {
                type: "text",
                text: typeof result === "string" ? result : JSON.stringify(result),
              },
            ],
            isError: false,
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    );
  }
}