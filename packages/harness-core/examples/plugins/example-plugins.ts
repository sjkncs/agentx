/**
 * Example Plugin - 示例插件
 * 
 * 展示如何创建和使用插件
 */

import type { Plugin, PluginContext, PluginMetadata } from "../plugins/plugin-types.js";

/**
 * 示例工具插件
 */
export class ToolPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: "example-tool-plugin",
    name: "Example Tool Plugin",
    version: "1.0.0",
    description: "Example plugin that adds custom tools",
    author: "DataFoundry Team",
  };
  
  async onMount(context: PluginContext): Promise<void> {
    console.log(`Plugin ${this.metadata.name} mounted`);
    
    // 注册事件监听
    context.events.on("tool/execute", (data) => {
      console.log("Tool executed:", data);
    });
  }
  
  async onUnmount(context: PluginContext): Promise<void> {
    console.log(`Plugin ${this.metadata.name} unmounted`);
  }
  
  registerServices(context: PluginContext): void {
    // 注册工具
    context.tools.register({
      name: "example_greet",
      description: "Greets a user by name",
      execute: async (input, ctx) => {
        const name = (input as { name?: string })?.name || "World";
        return { greeting: `Hello, ${name}!` };
      },
    });
    
    context.tools.register({
      name: "example_calculate",
      description: "Performs basic calculations",
      execute: async (input, ctx) => {
        const { a, b, operation } = input as { a: number; b: number; operation: string };
        
        switch (operation) {
          case "add":
            return { result: a + b };
          case "subtract":
            return { result: a - b };
          case "multiply":
            return { result: a * b };
          case "divide":
            if (b === 0) return { error: "Division by zero" };
            return { result: a / b };
          default:
            return { error: "Unknown operation" };
        }
      },
    });
  }
}

/**
 * 示例分析插件
 */
export class AnalyticsPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: "example-analytics-plugin",
    name: "Example Analytics Plugin",
    version: "1.0.0",
    description: "Example plugin that provides analytics",
    categories: ["analytics"],
  };
  
  private metrics: Array<{ timestamp: number; event: string; data: unknown }> = [];
  
  async onMount(context: PluginContext): Promise<void> {
    console.log(`Plugin ${this.metadata.name} mounted`);
    
    // 监听所有事件
    context.events.on("session/*", (data) => {
      this.recordMetric("session", data);
    });
    
    context.events.on("tool/*", (data) => {
      this.recordMetric("tool", data);
    });
  }
  
  async onUnmount(context: PluginContext): Promise<void> {
    console.log(`Plugin ${this.metadata.name} unmounted`);
  }
  
  registerServices(context: PluginContext): void {
    // 注册分析工具
    context.tools.register({
      name: "analytics_get_metrics",
      description: "Get recorded metrics",
      execute: async (input, ctx) => {
        return {
          metrics: this.metrics,
          count: this.metrics.length,
        };
      },
    });
    
    context.tools.register({
      name: "analytics_get_summary",
      description: "Get analytics summary",
      execute: async (input, ctx) => {
        const byType: Record<string, number> = {};
        for (const metric of this.metrics) {
          byType[metric.event] = (byType[metric.event] || 0) + 1;
        }
        
        return {
          totalEvents: this.metrics.length,
          byType,
          firstEvent: this.metrics[0]?.timestamp,
          lastEvent: this.metrics[this.metrics.length - 1]?.timestamp,
        };
      },
    });
  }
  
  private recordMetric(event: string, data: unknown): void {
    this.metrics.push({
      timestamp: Date.now(),
      event,
      data,
    });
    
    // 限制内存中的指标数量
    if (this.metrics.length > 10000) {
      this.metrics = this.metrics.slice(-5000);
    }
  }
}

/**
 * 示例协议插件
 */
export class ProtocolPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: "example-protocol-plugin",
    name: "Example Protocol Plugin",
    version: "1.0.0",
    description: "Example plugin that adds a custom protocol",
    categories: ["protocol"],
    dependencies: ["example-tool-plugin"],
  };
  
  async onMount(context: PluginContext): Promise<void> {
    console.log(`Plugin ${this.metadata.name} mounted`);
  }
  
  async onUnmount(context: PluginContext): Promise<void> {
    console.log(`Plugin ${this.metadata.name} unmounted`);
  }
  
  registerServices(context: PluginContext): void {
    // 注册协议处理工具
    context.tools.register({
      name: "protocol_custom_action",
      description: "Custom protocol action",
      execute: async (input, ctx) => {
        return {
          success: true,
          message: "Custom protocol action executed",
          input,
        };
      },
    });
  }
}
