/**
 * Service Registry Implementation
 */

import type { ServiceRegistry, ServiceDefinition } from "./plugin-types.js";

/**
 * Service Registry Implementation
 */
export class ServiceRegistryImpl implements ServiceRegistry {
  private services: Map<string, ServiceDefinition> = new Map();
  
  register<T>(name: string, instance: T, description?: string): void {
    this.services.set(name, {
      name,
      instance,
      description,
      singleton: true,
    });
  }
  
  get<T>(name: string): T | undefined {
    const def = this.services.get(name);
    return def ? (def.instance as T) : undefined;
  }
  
  has(name: string): boolean {
    return this.services.has(name);
  }
  
  unregister(name: string): boolean {
    return this.services.delete(name);
  }
  
  list(): string[] {
    return Array.from(this.services.keys());
  }
  
  getDefinition(name: string): ServiceDefinition | undefined {
    return this.services.get(name);
  }
}
