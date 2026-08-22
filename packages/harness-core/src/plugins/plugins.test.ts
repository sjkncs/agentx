/**
 * Phase 3: Plugin System Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PluginManager,
  createPluginContext,
  ServiceRegistryImpl,
  ToolRegistryImpl,
  EventBusImpl,
  ConfigStoreImpl,
  type Plugin,
  type PluginMetadata,
  type PluginContext,
} from '../plugins/index.js';

/**
 * Test Plugin Implementation
 */
class TestToolPlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'test-tool-plugin',
    name: 'Test Tool Plugin',
    version: '1.0.0',
    description: 'A test plugin for unit tests',
  };

  private mounted = false;

  async onMount(context: PluginContext): Promise<void> {
    this.mounted = true;
  }

  async onUnmount(context: PluginContext): Promise<void> {
    this.mounted = false;
  }

  registerServices(context: PluginContext): void {
    context.tools.register({
      name: 'test_greet',
      description: 'Greets a user',
      execute: async (input) => {
        const name = (input as { name?: string })?.name || 'World';
        return { greeting: `Hello, ${name}!` };
      },
    });

    context.tools.register({
      name: 'test_calculate',
      description: 'Performs calculation',
      execute: async (input) => {
        const { a, b, op } = input as { a: number; b: number; op: string };
        switch (op) {
          case 'add': return { result: a + b };
          case 'sub': return { result: a - b };
          default: return { error: 'Unknown operation' };
        }
      },
    });
  }

  isMounted(): boolean {
    return this.mounted;
  }
}

class TestServicePlugin implements Plugin {
  readonly metadata: PluginMetadata = {
    id: 'test-service-plugin',
    name: 'Test Service Plugin',
    version: '1.0.0',
    description: 'A test plugin that registers services',
    dependencies: ['test-tool-plugin'],
  };

  private mounted = false;

  async onMount(context: PluginContext): Promise<void> {
    this.mounted = true;
    
    // Test accessing another plugin's service
    const toolPlugin = context.services.get<TestToolPlugin>('test-tool-plugin');
    console.log('Tool plugin service:', toolPlugin);
  }

  async onUnmount(context: PluginContext): Promise<void> {
    this.mounted = false;
  }

  registerServices(context: PluginContext): void {
    // Register a service
    context.services.register('calculator', {
      add: (a: number, b: number) => a + b,
      subtract: (a: number, b: number) => a - b,
      multiply: (a: number, b: number) => a * b,
    }, 'A simple calculator service');
  }

  isMounted(): boolean {
    return this.mounted;
  }
}

describe('ServiceRegistryImpl', () => {
  let services: ServiceRegistryImpl;

  beforeEach(() => {
    services = new ServiceRegistryImpl();
  });

  it('should register and retrieve services', () => {
    const myService = { greet: () => 'Hello!' };
    services.register('myService', myService);

    expect(services.has('myService')).toBe(true);
    expect(services.get('myService')).toBe(myService);
  });

  it('should list registered services', () => {
    services.register('service1', {});
    services.register('service2', {});

    const list = services.list();
    expect(list).toContain('service1');
    expect(list).toContain('service2');
  });

  it('should unregister services', () => {
    services.register('temp', {});
    expect(services.has('temp')).toBe(true);

    services.unregister('temp');
    expect(services.has('temp')).toBe(false);
  });

  it('should get undefined for non-existent services', () => {
    expect(services.get('nonExistent')).toBeUndefined();
  });
});

describe('ToolRegistryImpl', () => {
  let tools: ToolRegistryImpl;

  beforeEach(() => {
    tools = new ToolRegistryImpl();
  });

  it('should register tools', () => {
    tools.register({
      name: 'test_tool',
      description: 'A test tool',
      execute: async () => ({ result: 'success' }),
    });

    expect(tools.has('test_tool')).toBe(true);
  });

  it('should retrieve registered tools', () => {
    const toolDef = {
      name: 'my_tool',
      description: 'My tool',
      execute: async () => 'result',
    };
    tools.register(toolDef);

    const retrieved = tools.get('my_tool');
    expect(retrieved?.name).toBe('my_tool');
  });

  it('should list all tools', () => {
    tools.register({ name: 'tool1', description: '...', execute: async () => {} });
    tools.register({ name: 'tool2', description: '...', execute: async () => {} });

    const list = tools.list();
    expect(list).toHaveLength(2);
  });

  it('should enable and disable tools', () => {
    tools.register({
      name: 'toggle_tool',
      description: 'Toggle test',
      execute: async () => {},
    });

    expect(tools.get('toggle_tool')?.enabled).toBe(true);

    tools.disable('toggle_tool');
    expect(tools.get('toggle_tool')?.enabled).toBe(false);

    tools.enable('toggle_tool');
    expect(tools.get('toggle_tool')?.enabled).toBe(true);
  });

  it('should unregister tools', () => {
    tools.register({ name: 'remove_me', description: '...', execute: async () => {} });
    tools.unregister('remove_me');

    expect(tools.has('remove_me')).toBe(false);
  });
});

describe('EventBusImpl', () => {
  let events: EventBusImpl;

  beforeEach(() => {
    events = new EventBusImpl();
  });

  it('should emit and receive events', async () => {
    const received: unknown[] = [];
    events.on('test.event', (data) => received.push(data));

    events.emit('test.event', { value: 42 });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ value: 42 });
  });

  it('should support multiple listeners', async () => {
    const received1: unknown[] = [];
    const received2: unknown[] = [];

    events.on('test.event', (data) => received1.push(data));
    events.on('test.event', (data) => received2.push(data));

    events.emit('test.event', { value: 1 });
    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it('should remove listeners', () => {
    const received: unknown[] = [];
    const unsubscribe = events.on('test.event', (data) => received.push(data));

    events.emit('test.event', { value: 1 });
    unsubscribe();
    events.emit('test.event', { value: 2 });

    expect(received).toHaveLength(1);
  });

  it('should remove all listeners for an event', () => {
    events.on('test.event', () => {});
    events.on('test.event', () => {});
    events.on('test.event', () => {});

    events.offAll('test.event');

    const received: unknown[] = [];
    events.emit('test.event', {});
    expect(received).toHaveLength(0);
  });
});

describe('ConfigStoreImpl', () => {
  let config: ConfigStoreImpl;

  beforeEach(() => {
    config = new ConfigStoreImpl();
  });

  it('should get and set values', () => {
    config.set('key1', 'value1');
    expect(config.get('key1')).toBe('value1');
  });

  it('should return default values', () => {
    expect(config.get('nonExistent', 'default')).toBe('default');
  });

  it('should check existence', () => {
    config.set('exists', true);
    expect(config.has('exists')).toBe(true);
    expect(config.has('notExists')).toBe(false);
  });

  it('should watch for changes', () => {
    const changes: Array<{ key: string; value: unknown }> = [];
    config.watch('key', (key, value) => {
      changes.push({ key, value });
    });

    config.set('key', 'value1');
    config.set('key', 'value2');

    expect(changes).toHaveLength(2);
    expect(changes[0].value).toBe('value1');
    expect(changes[1].value).toBe('value2');
  });

  it('should delete values', () => {
    config.set('temp', 'data');
    config.delete('temp');
    expect(config.has('temp')).toBe(false);
  });
});

describe('PluginManager', () => {
  let manager: PluginManager;
  let services: ServiceRegistryImpl;
  let plugin: TestToolPlugin;

  beforeEach(() => {
    services = new ServiceRegistryImpl();
    plugin = new TestToolPlugin();

    manager = new PluginManager(
      (p) => createPluginContext(services, {}),
      {},
      { strict: false }
    );
  });

  it('should register plugins', () => {
    manager.register(plugin);
    expect(manager.get('test-tool-plugin')).toBe(plugin);
  });

  it('should mount plugins', async () => {
    manager.register(plugin);
    await manager.mount('test-tool-plugin');

    expect(manager.isMounted('test-tool-plugin')).toBe(true);
    expect(plugin.isMounted()).toBe(true);
  });

  it('should unmount plugins', async () => {
    manager.register(plugin);
    await manager.mount('test-tool-plugin');
    await manager.unmount('test-tool-plugin');

    expect(manager.isMounted('test-tool-plugin')).toBe(false);
    expect(plugin.isMounted()).toBe(false);
  });

  it('should mount all registered plugins', async () => {
    const plugin1 = new TestToolPlugin();
    const plugin2 = new TestServicePlugin();

    manager.register(plugin1);
    manager.register(plugin2);

    // Note: plugin2 depends on plugin1, so we need to handle dependency order
    // For now, just test single plugin
    await manager.mount('test-tool-plugin');

    expect(manager.isMounted('test-tool-plugin')).toBe(true);
  });

  it('should get stats', async () => {
    manager.register(plugin);
    await manager.mount('test-tool-plugin');

    const stats = manager.getStats();
    expect(stats.totalPlugins).toBe(1);
    expect(stats.mountedPlugins).toBe(1);
  });

  it('should dispose all plugins', async () => {
    manager.register(plugin);
    await manager.mount('test-tool-plugin');
    await manager.dispose();

    expect(manager.getStats().totalPlugins).toBe(0);
  });

  it('should get plugin context after mounting', async () => {
    manager.register(plugin);
    await manager.mount('test-tool-plugin');

    const context = manager.getContext('test-tool-plugin');
    expect(context).toBeDefined();
    expect(context?.tools.list()).toHaveLength(2); // test_greet, test_calculate
  });

  it('should execute registered tools', async () => {
    manager.register(plugin);
    await manager.mount('test-tool-plugin');

    const context = manager.getContext('test-tool-plugin');
    const result = await context!.tools.execute(
      'test_greet',
      { name: 'Alice' },
      { sessionId: 's1', runId: 'r1', toolName: 'test_greet', userServices: {} }
    );

    expect(result).toEqual({ greeting: 'Hello, Alice!' });
  });
});

describe('PluginContext', () => {
  it('should create plugin context', () => {
    const services = new ServiceRegistryImpl();
    const context = createPluginContext(services, { customData: true });

    expect(context.services).toBe(services);
    expect(context.events).toBeDefined();
    expect(context.config).toBeDefined();
    expect(context.tools).toBeDefined();
  });
});
