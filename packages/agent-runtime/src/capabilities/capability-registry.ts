/**
 * Capability Registry — plugin-based tool capability management.
 *
 * Manages CapabilityPlugin registrations for the agent tool governance system.
 * Each plugin declares the actions it provides and their input/output schemas.
 *
 * NOTE: This is the original plugin-based registry. For workspace-level
 * capability policy evaluation (adminOnly, requiresApproval, valueThresholds),
 * see capability-guard.ts which operates at a different abstraction level.
 */
import type { CapabilityPlugin } from "./types.js";
import { z } from "zod";

export class CapabilityRegistry {
  private readonly _plugins = new Map<string, CapabilityPlugin>();
  private readonly _actionPlugins = new Map<string, string>(); // actionName → pluginId

  /**
   * Register a capability plugin. Throws if a plugin with the same id is already
   * registered, or if any of its actions conflict with another plugin.
   */
  register(plugin: CapabilityPlugin): void {
    if (this._plugins.has(plugin.manifest.id)) {
      throw new Error(`CAPABILITY_PLUGIN_ALREADY_REGISTERED:${plugin.manifest.id}`);
    }
    for (const action of plugin.actions) {
      const existing = this._actionPlugins.get(action.name);
      if (existing) {
        throw new Error(
          `CAPABILITY_ACTION_ALREADY_REGISTERED:${action.name}:${existing}:${plugin.manifest.id}`,
        );
      }
      this._actionPlugins.set(action.name, plugin.manifest.id);
    }
    this._plugins.set(plugin.manifest.id, plugin);
  }

  /**
   * Initialize all plugins in registration order.
   */
  async initialize(): Promise<void> {
    for (const plugin of this._plugins.values()) {
      if (plugin.initialize) {
        await plugin.initialize();
      }
    }
  }

  /**
   * Dispose all plugins in reverse registration order.
   */
  async dispose(): Promise<void> {
    const reversed = [...this._plugins.values()].reverse();
    for (const plugin of reversed) {
      if (plugin.dispose) {
        await plugin.dispose();
      }
    }
  }

  /**
   * Get a plugin by id.
   */
  get(pluginId: string): CapabilityPlugin | undefined {
    return this._plugins.get(pluginId);
  }

  /**
   * Get all registered plugin ids.
   */
  list(): string[] {
    return [...this._plugins.keys()];
  }

  /**
   * Check if an action is registered by any plugin.
   */
  hasAction(actionName: string): boolean {
    return this._actionPlugins.has(actionName);
  }

  /**
   * Get the plugin that registered a given action.
   */
  pluginForAction(actionName: string): string | undefined {
    return this._actionPlugins.get(actionName);
  }

  /**
   * Resolve an action name to its registered definition and plugin metadata.
   */
  resolve(actionName: string): {
    action: CapabilityPlugin["actions"][0];
    pluginId: string;
    pluginVersion: string;
  } | null {
    const pluginId = this._actionPlugins.get(actionName);
    if (!pluginId) return null;
    const plugin = this._plugins.get(pluginId);
    if (!plugin) return null;
    const action = plugin.actions.find((a: CapabilityPlugin["actions"][0]) => a.name === actionName);
    if (!action) return null;
    return {
      action,
      pluginId: plugin.manifest.id,
      pluginVersion: plugin.manifest.version,
    };
  }
}
