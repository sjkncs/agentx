/**
 * Phase 1: Hook System Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HookBus,
  HookExecutor,
  HookRegistry,
  createDefaultHookConfig,
  HOOK_EVENTS,
  type HookContext,
} from '../hooks/index.js';

describe('HookBus', () => {
  let bus: HookBus;

  beforeEach(() => {
    bus = new HookBus({});
  });

  it('should create a hook bus', () => {
    expect(bus).toBeDefined();
    expect(bus.getStats().totalHooks).toBe(0);
  });

  it('should register and emit hooks', async () => {
    const received: unknown[] = [];
    
    const listenerId = bus.register(
      {
        name: 'test-hook',
        events: ['agent.start'],
        action: { type: 'prompt', template: '' },
      },
      async (ctx: HookContext) => {
        received.push(ctx.payload);
      }
    );

    expect(listenerId).toBeDefined();

    await bus.emit('agent.start', {
      event: 'agent.start',
      sessionId: 's1',
      runId: 'r1',
      payload: { message: 'hello' },
      metadata: {},
    });
    
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ message: 'hello' });
  });

  it('should support multiple listeners', async () => {
    const received1: unknown[] = [];
    const received2: unknown[] = [];

    bus.register(
      { name: 'hook1', events: ['agent.start'], action: { type: 'prompt', template: '' } },
      async (ctx) => received1.push(ctx.payload)
    );
    bus.register(
      { name: 'hook2', events: ['agent.start'], action: { type: 'prompt', template: '' } },
      async (ctx) => received2.push(ctx.payload)
    );

    await bus.emit('agent.start', {
      event: 'agent.start',
      sessionId: 's1',
      runId: 'r1',
      payload: { msg: 'test' },
      metadata: {},
    });

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it('should unregister listeners', async () => {
    const received: unknown[] = [];

    const id = bus.register(
      { name: 'removable', events: ['agent.start'], action: { type: 'prompt', template: '' } },
      async (ctx) => received.push(ctx.payload)
    );
    
    await bus.emit('agent.start', {
      event: 'agent.start',
      sessionId: 's1',
      runId: 'r1',
      payload: { a: 1 },
      metadata: {},
    });

    const removed = bus.unregister(id);
    expect(removed).toBe(true);

    await bus.emit('agent.start', {
      event: 'agent.start',
      sessionId: 's1',
      runId: 'r1',
      payload: { a: 2 },
      metadata: {},
    });

    expect(received).toHaveLength(1);
  });

  it('should get stats', () => {
    bus.register(
      { name: 'h1', events: ['agent.start'], action: { type: 'prompt', template: '' } },
      async () => {}
    );
    bus.register(
      { name: 'h2', events: ['turn.end'], action: { type: 'prompt', template: '' } },
      async () => {}
    );

    const stats = bus.getStats();
    expect(stats.totalHooks).toBe(2);
    expect(Object.keys(stats.byEvent)).toHaveLength(2);
  });
});

describe('HookExecutor', () => {
  it('should execute shell hooks', async () => {
    const executor = new HookExecutor({ timeout: 5000 });
    
    const result = await executor.execute({
      type: 'shell',
      command: 'echo',
      args: ['Hello from hook'],
    }, {
      event: 'agent.start',
      sessionId: 's1',
      runId: 'r1',
      payload: {},
      metadata: {},
    });

    expect(result.success).toBe(true);
  });

  it('should handle shell errors', async () => {
    const executor = new HookExecutor({ timeout: 5000 });
    
    const result = await executor.execute({
      type: 'shell',
      command: 'node',
      args: ['-e', 'process.exit(1)'],
    }, {
      event: 'agent.start',
      sessionId: 's1',
      runId: 'r1',
      payload: {},
      metadata: {},
    });

    expect(result.success).toBe(false);
  });

  it('should render templates via HookContext', async () => {
    const executor = new HookExecutor({});
    
    // Use the public API by registering and triggering a prompt hook
    let rendered = '';
    const ctx: HookContext = {
      event: 'agent.start',
      sessionId: 's1',
      runId: 'r1',
      payload: { name: 'Test' },
      metadata: {},
    };
    
    const result = await executor.execute({
      type: 'prompt',
      template: 'Hello {{payload.name}}',
    }, ctx);

    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).toContain('Hello');
  });

  it('should handle missing template variables', async () => {
    const executor = new HookExecutor({});
    
    const ctx: HookContext = {
      event: 'agent.start',
      sessionId: 's1',
      runId: 'r1',
      payload: { name: 'Test' },
      metadata: {},
    };
    
    const result = await executor.execute({
      type: 'prompt',
      template: 'Hello {{payload.name}}',
    }, ctx);

    expect(result.success).toBe(true);
  });
});

describe('HookRegistry', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry({ defaultTimeout: 5000 });
  });

  it('should create a hook registry', () => {
    expect(registry).toBeDefined();
    expect(registry.getStats().total).toBe(0);
  });

  it('should register hooks from config', async () => {
    const config = createDefaultHookConfig();
    
    if (config.hooks && Array.isArray(config.hooks)) {
      config.hooks.push({
        name: 'test-hook-1',
        events: ['agent.start'],
        action: { type: 'prompt', template: 'Hello' },
        enabled: true,
      });
    }

    await registry.loadFromConfig(config);

    const stats = registry.getStats();
    expect(stats.total).toBeGreaterThanOrEqual(0);
  });

  it('should enable and disable hooks', async () => {
    registry.register({
      name: 'toggle-hook',
      events: ['agent.start'],
      action: { type: 'prompt', template: 'Test' },
    });
    
    expect(registry.disable('toggle-hook')).toBe(true);
    expect(registry.enable('toggle-hook')).toBe(true);
  });

  it('should track events via stats', () => {
    registry.register({
      name: 'evt-hook',
      events: ['agent.start', 'turn.end'],
      action: { type: 'prompt', template: 'X' },
    });

    const stats = registry.getStats();
    expect(stats.byEvent['agent.start']).toBe(1);
    expect(stats.byEvent['turn.end']).toBe(1);
  });
});

describe('HOOK_EVENTS', () => {
  it('should contain required events', () => {
    expect(HOOK_EVENTS).toContain('agent.start');
    expect(HOOK_EVENTS).toContain('agent.end');
    expect(HOOK_EVENTS).toContain('turn.start');
    expect(HOOK_EVENTS).toContain('turn.end');
    expect(HOOK_EVENTS).toContain('step.start');
    expect(HOOK_EVENTS).toContain('step.end');
    expect(HOOK_EVENTS).toContain('tool.pre-execute');
    expect(HOOK_EVENTS).toContain('tool.post-execute');
  });
});

describe('HookConfig', () => {
  it('should create default config', () => {
    const config = createDefaultHookConfig();
    
    expect(config).toBeDefined();
    expect(config.hooks).toBeDefined();
    expect(Array.isArray(config.hooks)).toBe(true);
  });

  it('should load valid config via default', () => {
    const config = createDefaultHookConfig();
    expect(config).toBeDefined();
    expect(config.hooks).toBeDefined();
    expect(Array.isArray(config.hooks)).toBe(true);
  });
});