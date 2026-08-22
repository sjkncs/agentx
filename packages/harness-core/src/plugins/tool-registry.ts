/**
 * Tool Registry Implementation
 */

import type { ToolDefinition, PluginToolRegistry, PluginToolContext } from "./plugin-types.js";

/**
 * Tool Registry Implementation
 */
export class ToolRegistryImpl implements PluginToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, { ...tool, enabled: tool.enabled ?? true });
  }
  
  registerMany(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }
  
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
  
  has(name: string): boolean {
    return this.tools.has(name);
  }
  
  enable(name: string): boolean {
    const tool = this.tools.get(name);
    if (tool) {
      tool.enabled = true;
      return true;
    }
    return false;
  }
  
  disable(name: string): boolean {
    const tool = this.tools.get(name);
    if (tool) {
      tool.enabled = false;
      return true;
    }
    return false;
  }
  
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }
  
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
  
  listEnabled(): ToolDefinition[] {
    return this.list().filter((t) => t.enabled);
  }
  
  async execute(
    name: string,
    input: unknown,
    context: PluginToolContext
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    if (!tool.enabled) {
      throw new Error(`Tool not enabled: ${name}`);
    }
    return tool.execute(input, context);
  }
}
