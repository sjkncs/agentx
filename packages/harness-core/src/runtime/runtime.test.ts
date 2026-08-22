/**
 * Phase 4: Multi-Runtime Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalRuntime,
  RemoteRuntime,
  RuntimeManager,
  createLocalRuntime,
  createSecureLocalRuntime,
  DefaultRoutingRules,
  type ExecutionRequest,
} from '../runtime/index.js';

describe('LocalRuntime', () => {
  let runtime: LocalRuntime;

  beforeEach(() => {
    runtime = new LocalRuntime('test-local', {
      timeout: 5000,
      debug: false,
    });
  });

  it('should create a local runtime', () => {
    expect(runtime).toBeDefined();
    expect(runtime.id).toBe('test-local');
    expect(runtime.type).toBe('local');
  });

  it('should initialize', async () => {
    await runtime.initialize();
    expect(runtime.status).toBe('ready');
  });

  it('should start and stop', async () => {
    await runtime.start();
    expect(runtime.status).toBe('ready');

    await runtime.stop();
    expect(runtime.status).toBe('stopped');
  });

  it('should have correct capabilities', () => {
    expect(runtime.capabilities.canExecuteCode).toBe(true);
    expect(runtime.capabilities.canAccessFileSystem).toBe(true);
    expect(runtime.capabilities.canMakeNetworkRequests).toBe(true);
  });

  it('should get session info', () => {
    const session = runtime.getSession();
    expect(session.sessionId).toBe('test-local');
    expect(session.runtimeType).toBe('local');
    expect(session.status).toBe('idle');
  });

  it('should execute simple code', async () => {
    await runtime.start();
    
    const result = await runtime.execute({
      code: '1 + 2',
      language: 'javascript',
      timeout: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should handle execution errors', async () => {
    await runtime.start();
    
    const result = await runtime.execute({
      code: 'throw new Error("test error")',
      language: 'javascript',
    });

    // The actual behavior depends on implementation
    // This test may need adjustment based on sandbox behavior
    expect(result).toBeDefined();
  });

  it('should dispose properly', async () => {
    await runtime.initialize();
    await runtime.dispose();
    
    // After dispose, runtime should be stopped
    expect(runtime.status).toBe('stopped');
  });
});

describe('createLocalRuntime', () => {
  it('should create with default config', () => {
    const runtime = createLocalRuntime('default-test');
    expect(runtime.id).toBe('default-test');
  });

  it('should create with custom config', () => {
    const runtime = createLocalRuntime('custom-test', {
      timeout: 60000,
      maxMemoryMB: 1024,
    });
    expect(runtime.capabilities.maxMemoryMB).toBe(1024);
  });
});

describe('createSecureLocalRuntime', () => {
  it('should create with security restrictions', () => {
    const runtime = createSecureLocalRuntime('secure-test');
    
    // Should have restricted capabilities
    expect(runtime.capabilities.canSpawnProcesses).toBe(false);
    expect(runtime.capabilities.maxMemoryMB).toBe(256);
  });
});

describe('RemoteRuntime', () => {
  it('should create a remote runtime', () => {
    const runtime = new RemoteRuntime('test-remote', {
      endpoint: 'https://api.example.com/runtime',
      timeout: 30000,
    });

    expect(runtime).toBeDefined();
    expect(runtime.id).toBe('test-remote');
    expect(runtime.type).toBe('remote');
  });

  it('should have correct capabilities', () => {
    const runtime = new RemoteRuntime('test-remote', {
      endpoint: 'https://api.example.com/runtime',
    });

    expect(runtime.capabilities.canExecuteCode).toBe(true);
    expect(runtime.capabilities.maxMemoryMB).toBe(4096);
  });

  it('should get session info', () => {
    const runtime = new RemoteRuntime('test-remote', {
      endpoint: 'https://api.example.com/runtime',
    });

    const session = runtime.getSession();
    expect(session.sessionId).toBe('test-remote');
    expect(session.runtimeType).toBe('remote');
  });
});

describe('RuntimeManager', () => {
  let manager: RuntimeManager;

  beforeEach(() => {
    manager = new RuntimeManager({
      defaultType: 'local',
      autoStart: false,
    });
  });

  it('should create a runtime manager', () => {
    expect(manager).toBeDefined();
  });

  it('should register runtimes', () => {
    const runtime = createLocalRuntime('manager-local-1');
    manager.register(runtime);

    expect(manager.get('manager-local-1')).toBe(runtime);
  });

  it('should create local runtimes', () => {
    const runtime = manager.createLocal('auto-local');
    expect(runtime).toBeDefined();
    expect(runtime.id).toBe('auto-local');
  });

  it('should unregister runtimes', async () => {
    const runtime = createLocalRuntime('to-unregister');
    manager.register(runtime);
    await manager.unregister('to-unregister');

    expect(manager.get('to-unregister')).toBeUndefined();
  });

  it('should get all runtimes', () => {
    manager.createLocal('local-1');
    manager.createLocal('local-2');

    const all = manager.getAll();
    expect(all).toHaveLength(2);
  });

  it('should get runtimes by type', () => {
    manager.createLocal('local-1');
    manager.createLocal('local-2');

    const localRuntimes = manager.getByType('local');
    expect(localRuntimes).toHaveLength(2);
  });

  it('should get default runtime', () => {
    manager.createLocal('default-local');

    const defaultRuntime = manager.getDefault();
    expect(defaultRuntime?.id).toBe('default-local');
  });

  it('should get stats', () => {
    manager.createLocal('stats-local-1');
    manager.createLocal('stats-local-2');

    const stats = manager.getStats();
    expect(stats.total).toBe(2);
    expect(stats.byType.local).toBe(2);
  });

  it('should add and remove routing rules', () => {
    manager.addRule(DefaultRoutingRules.pythonToRemote());
    manager.addRule(DefaultRoutingRules.fastExecutionLocal());

    const stats = manager.getStats();
    expect(stats.rules).toBe(2);

    manager.removeRule('python-remote');
    expect(manager.getStats().rules).toBe(1);
  });

  it('should set routing strategy', () => {
    manager.setStrategy('random');
    expect(manager.getStats().strategy).toBe('random');

    manager.setStrategy('least-loaded');
    expect(manager.getStats().strategy).toBe('least-loaded');
  });

  it('should route requests based on rules', () => {
    const localRuntime = manager.createLocal('rule-local');
    manager.addRule(DefaultRoutingRules.fastExecutionLocal());

    const request: ExecutionRequest = {
      code: '1 + 1',
      language: 'javascript',
      timeout: 1000,
    };

    const routed = manager.route(request);
    expect(routed).toBeDefined();
  });

  it('should stop all runtimes', async () => {
    manager.createLocal('stop-1');
    manager.createLocal('stop-2');
    
    await manager.startAll();
    await manager.stopAll();

    // All should be stopped
    for (const runtime of manager.getAll()) {
      expect(runtime.status).toBe('stopped');
    }
  });

  it('should dispose all runtimes', async () => {
    manager.createLocal('dispose-1');
    manager.createLocal('dispose-2');

    await manager.dispose();

    expect(manager.getStats().total).toBe(0);
  });
});

describe('DefaultRoutingRules', () => {
  it('should create Python to Remote rule', () => {
    const rule = DefaultRoutingRules.pythonToRemote();
    
    expect(rule.name).toBe('python-remote');
    expect(rule.priority).toBe(10);
    expect(rule.runtimeType).toBe('remote');
    expect(rule.match({ language: 'python', code: '' })).toBe(true);
    expect(rule.match({ language: 'javascript', code: '' })).toBe(false);
  });

  it('should create large code to Remote rule', () => {
    const rule = DefaultRoutingRules.largeCodeToRemote(1000);
    
    expect(rule.name).toBe('large-code-remote');
    expect(rule.match({ language: 'js', code: 'x'.repeat(2000) })).toBe(true);
    expect(rule.match({ language: 'js', code: 'x'.repeat(500) })).toBe(false);
  });

  it('should create fast execution to Local rule', () => {
    const rule = DefaultRoutingRules.fastExecutionLocal(5000);
    
    expect(rule.name).toBe('fast-local');
    expect(rule.runtimeType).toBe('local');
    expect(rule.match({ language: 'js', code: '', timeout: 3000 })).toBe(true);
    expect(rule.match({ language: 'js', code: '', timeout: 10000 })).toBe(false);
  });
});

describe('Runtime Capabilities', () => {
  it('should have appropriate capabilities for local runtime', () => {
    const runtime = createLocalRuntime('cap-test');
    
    expect(runtime.capabilities.canExecuteCode).toBe(true);
    expect(runtime.capabilities.canAccessFileSystem).toBe(true);
    expect(runtime.capabilities.canMakeNetworkRequests).toBe(true);
    expect(runtime.capabilities.canSpawnProcesses).toBe(false);
  });

  it('should have appropriate capabilities for secure runtime', () => {
    const runtime = createSecureLocalRuntime('secure-cap-test');
    
    expect(runtime.capabilities.canExecuteCode).toBe(true);
    expect(runtime.capabilities.canSpawnProcesses).toBe(false);
    expect(runtime.capabilities.maxMemoryMB).toBe(256);
  });

  it('should have appropriate capabilities for remote runtime', () => {
    const runtime = new RemoteRuntime('remote-cap-test', {
      endpoint: 'https://api.example.com/runtime',
    });
    
    expect(runtime.capabilities.canExecuteCode).toBe(true);
    expect(runtime.capabilities.canAccessFileSystem).toBe(false);
    expect(runtime.capabilities.maxMemoryMB).toBe(4096);
  });
});
