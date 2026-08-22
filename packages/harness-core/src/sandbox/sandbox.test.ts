/**
 * Phase 7 & 8 Tests: Sandbox + Gates
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Sandbox,
  ProcessSandbox,
  VmSandbox,
  SandboxManager,
  createSandbox,
  createSandboxManager,
  SandboxError,
  type SandboxConfig,
} from '../sandbox/index.js';

import {
  GateManager,
  createGateManager,
  lintGateExecutor,
  testGateExecutor,
  typeCheckGateExecutor,
  GateExecutionError,
  type GateConfig,
  type GateContext,
  type GatePipeline,
} from '../gates/index.js';

describe('Sandbox Base', () => {
  it('should create a VM sandbox by default', () => {
    const sandbox = createSandbox({
      type: 'vm',
    });
    
    expect(sandbox).toBeDefined();
    expect(sandbox.type).toBe('vm');
    expect(sandbox.getStatus()).toBe('created');
  });

  it('should generate unique ID', () => {
    const s1 = createSandbox({ type: 'vm' });
    const s2 = createSandbox({ type: 'vm' });
    
    expect(s1.id).not.toBe(s2.id);
  });

  it('should use provided ID if given', () => {
    const sandbox = createSandbox({
      type: 'vm',
      id: 'custom-id',
    });
    
    expect(sandbox.id).toBe('custom-id');
  });
});

describe('VmSandbox', () => {
  let sandbox: VmSandbox;
  
  beforeEach(async () => {
    sandbox = new VmSandbox({
      type: 'vm',
      name: 'test-vm-sandbox',
    });
    await sandbox.start();
  });
  
  afterEach(async () => {
    await sandbox.destroy();
  });
  
  it('should start and be running', () => {
    expect(sandbox.getStatus()).toBe('running');
  });
  
  it('should execute simple code', async () => {
    const result = await sandbox.execute({
      code: '1 + 2',
    });
    
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });
  
  it('should capture console.log output', async () => {
    const result = await sandbox.execute({
      code: 'console.log("Hello from VM");',
    });
    
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('Hello from VM');
  });
  
  it('should capture console.error', async () => {
    const result = await sandbox.execute({
      code: 'console.error("Error message");',
    });
    
    expect(result.success).toBe(true);
    expect(result.stderr).toContain('Error message');
  });
  
  it('should return result value', async () => {
    const result = await sandbox.execute({
      code: 'const x = 42; x * 2;',
    });
    
    expect(result.success).toBe(true);
    expect((result as any).result).toBe(84);
  });
  
  it('should handle execution errors', async () => {
    const result = await sandbox.execute({
      code: 'throw new Error("test error");',
    });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('test error');
  });
  
  it('should timeout long-running code', async () => {
    const result = await sandbox.execute({
      code: 'while(true) {}',
      timeout: 500,
    });
    
    // VM can detect timeout (timedOut=true) or throw a runtime error
    expect(result.success).toBe(false);
    expect(result.timedOut === true || (result.error && result.error.length > 0)).toBe(true);
  });
  
  it('should not have access to process', async () => {
    const result = await sandbox.execute({
      code: 'typeof process',
    });
    
    expect(result.success).toBe(true);
    // process is not defined in VM context
    expect((result as any).result).toBe('undefined');
  });
  
  it('should isolate Date and Math', async () => {
    const result = await sandbox.execute({
      code: 'typeof Date + " " + typeof Math',
    });
    
    expect(result.success).toBe(true);
    expect((result as any).result).toContain('function');
  });
  
  it('should stop and not execute', async () => {
    await sandbox.stop();
    expect(sandbox.getStatus()).toBe('stopped');
    
    await expect(
      sandbox.execute({ code: '1+1' })
    ).rejects.toThrow();
  });
});

describe('ProcessSandbox', () => {
  let sandbox: ProcessSandbox;
  
  afterEach(async () => {
    if (sandbox) {
      await sandbox.destroy();
    }
  });
  
  it('should create a process sandbox', () => {
    sandbox = new ProcessSandbox({
      type: 'process',
      command: 'node',
      args: ['-e', 'console.log("ready")'],
    });
    
    expect(sandbox).toBeDefined();
    expect(sandbox.type).toBe('process');
  });
  
  it('should start a long-running process', async () => {
    sandbox = new ProcessSandbox({
      type: 'process',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    });
    
    await sandbox.start();
    expect(sandbox.getStatus()).toBe('running');
    expect(sandbox.getPid()).toBeDefined();
    
    await sandbox.stop();
    expect(sandbox.getStatus()).toBe('stopped');
  });
  
  it('should execute command in process sandbox', async () => {
    sandbox = new ProcessSandbox({
      type: 'process',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    });
    
    await sandbox.start();
    
    const result = await sandbox.execute({
      command: process.execPath,
      args: ['-e', 'console.log("executed")'],
    });
    
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('executed');
  });
  
  it('should handle execution errors', async () => {
    sandbox = new ProcessSandbox({
      type: 'process',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    });
    
    await sandbox.start();
    
    const result = await sandbox.execute({
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
    });
    
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});

describe('Sandbox Permissions', () => {
  it('should check permission correctly', () => {
    const sandbox = createSandbox({
      type: 'vm',
      permissions: {
        allowNetwork: true,
        allowWrite: false,
        allowShell: false,
        allowNativeModules: false,
      },
    });
    
    expect(sandbox.checkPermission('allowNetwork')).toBe(true);
    expect(sandbox.checkPermission('allowWrite')).toBe(false);
    expect(sandbox.checkPermission('allowShell')).toBe(false);
  });
  
  it('should check file permissions with patterns', () => {
    const sandbox = createSandbox({
      type: 'vm',
      permissions: {
        files: [
          { pattern: '/tmp/*', read: true, write: true, execute: false },
          { pattern: '/etc/*', read: true, write: false, execute: false },
        ],
      },
    });
    
    expect(sandbox.checkFilePermission('/tmp/test.txt', 'read')).toBe(true);
    expect(sandbox.checkFilePermission('/tmp/test.txt', 'write')).toBe(true);
    expect(sandbox.checkFilePermission('/etc/passwd', 'read')).toBe(true);
    expect(sandbox.checkFilePermission('/etc/passwd', 'write')).toBe(false);
  });
  
  it('should return false for unmatched patterns', () => {
    const sandbox = createSandbox({
      type: 'vm',
      permissions: {
        files: [
          { pattern: '/tmp/*', read: true, write: false, execute: false },
        ],
      },
    });
    
    expect(sandbox.checkFilePermission('/var/log/test', 'read')).toBe(false);
  });
});

describe('SandboxManager', () => {
  let manager: SandboxManager;
  
  beforeEach(() => {
    manager = createSandboxManager({
      maxSandboxes: 5,
      defaultType: 'vm',
    });
  });
  
  afterEach(async () => {
    await manager.dispose();
  });
  
  it('should create a manager', () => {
    expect(manager).toBeDefined();
  });
  
  it('should create sandboxes', () => {
    const s1 = manager.create({ type: 'vm' });
    const s2 = manager.create({ type: 'vm' });
    
    expect(manager.getAll()).toHaveLength(2);
    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
  });
  
  it('should get by status', async () => {
    const s1 = manager.create({ type: 'vm' });
    const s2 = manager.create({ type: 'vm' });
    
    await s1.start();
    
    const running = manager.getRunning();
    expect(running).toHaveLength(1);
    expect(running[0]).toBe(s1);
  });
  
  it('should enforce max sandboxes', () => {
    for (let i = 0; i < 5; i++) {
      manager.create({ type: 'vm' });
    }
    
    expect(() => manager.create({ type: 'vm' })).toThrow();
  });
  
  it('should cleanup stopped sandboxes', async () => {
    const s1 = manager.create({ type: 'vm' });
    const s2 = manager.create({ type: 'vm' });
    
    await s1.start();
    await s1.stop();
    
    manager.cleanup();
    
    // s1 should be removed, s2 still exists
    expect(manager.getAll()).toHaveLength(1);
  });
  
  it('should get stats', async () => {
    const s1 = manager.create({ type: 'vm' });
    await s1.start();
    
    manager.create({ type: 'vm' });
    
    const stats = manager.getStats();
    expect(stats.total).toBe(2);
    expect(stats.byStatus.running).toBe(1);
    expect(stats.byStatus.created).toBe(1);
  });
  
  it('should dispose all sandboxes', async () => {
    const s1 = manager.create({ type: 'vm' });
    await s1.start();
    
    await manager.dispose();
    expect(manager.getAll()).toHaveLength(0);
  });
});

// ============================================================================
// Phase 8: Gate Tests
// ============================================================================

describe('GateManager', () => {
  let manager: GateManager;
  
  beforeEach(() => {
    manager = createGateManager({
      defaultTimeout: 30000,
      defaultRetries: 1,
    });
  });
  
  afterEach(() => {
    manager.dispose();
  });
  
  it('should create a manager', () => {
    expect(manager).toBeDefined();
  });
  
  it('should register built-in executors', () => {
    const types = manager.getSupportedTypes();
    expect(types).toContain('lint');
    expect(types).toContain('test');
    expect(types).toContain('typecheck');
    expect(types).toContain('build');
  });
  
  it('should register custom executor', () => {
    manager.register('custom', async (config, context) => ({
      gateId: config.id || 'custom',
      gateName: config.name,
      gateType: 'custom',
      status: 'passed',
      passed: true,
      message: 'Custom passed',
      issues: [],
      duration: 0,
      startedAt: Date.now(),
      endedAt: Date.now(),
    }));
    
    expect(manager.getSupportedTypes()).toContain('custom');
  });
  
  it('should execute custom gate', async () => {
    manager.register('test-custom', async () => ({
      gateId: 'test-custom',
      gateName: 'Test Custom',
      gateType: 'custom',
      status: 'passed',
      passed: true,
      message: 'OK',
      issues: [],
      duration: 10,
      startedAt: Date.now(),
      endedAt: Date.now(),
    }));
    
    const result = await manager.executeGate(
      {
        name: 'Test Custom Gate',
        type: 'test-custom',
      },
      { workdir: process.cwd() },
    );
    
    expect(result.passed).toBe(true);
    expect(result.status).toBe('passed');
  });
  
  it('should fail gate without executor', async () => {
    await expect(
      manager.executeGate(
        { name: 'Unknown', type: 'unknown' as any },
        { workdir: process.cwd() },
      ),
    ).rejects.toThrow(GateExecutionError);
  });
  
  it('should track history', async () => {
    manager.register('test-history', async () => ({
      gateId: 'test-history',
      gateName: 'History',
      gateType: 'custom',
      status: 'passed',
      passed: true,
      message: 'OK',
      issues: [],
      duration: 0,
      startedAt: Date.now(),
      endedAt: Date.now(),
    }));
    
    await manager.executeGate(
      { name: 'History', type: 'test-history' },
      { workdir: process.cwd() },
    );
    
    expect(manager.getHistory()).toHaveLength(1);
  });
  
  it('should skip when skipIf returns true', async () => {
    manager.register('test-skip', async () => ({
      gateId: 'test-skip',
      gateName: 'Skip',
      gateType: 'custom',
      status: 'passed',
      passed: true,
      message: 'OK',
      issues: [],
      duration: 0,
      startedAt: Date.now(),
      endedAt: Date.now(),
    }));
    
    const result = await manager.executeGate(
      {
        name: 'Skip',
        type: 'test-skip',
        skipIf: () => true,
      },
      { workdir: process.cwd() },
    );
    
    expect(result.status).toBe('skipped');
  });
  
  it('should retry on failure', async () => {
    let attempts = 0;
    manager.register('test-retry', async () => {
      attempts++;
      return {
        gateId: 'test-retry',
        gateName: 'Retry',
        gateType: 'custom',
        status: attempts >= 2 ? 'passed' : 'failed',
        passed: attempts >= 2,
        message: `Attempt ${attempts}`,
        issues: [],
        duration: 0,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
    });
    
    const result = await manager.executeGate(
      {
        name: 'Retry',
        type: 'test-retry',
        required: true,
        retries: 3,
        retryDelay: 10,
      },
      { workdir: process.cwd() },
    );
    
    expect(result.passed).toBe(true);
    expect(attempts).toBe(2);
  });
  
  it('should get statistics', async () => {
    manager.register('test-stats', async (config, context) => {
      const shouldFail = context.data?.shouldFail || false;
      return {
        gateId: 'test-stats',
        gateName: 'Stats',
        gateType: 'custom',
        status: shouldFail ? 'failed' : 'passed',
        passed: !shouldFail,
        message: shouldFail ? 'Failed' : 'OK',
        issues: [],
        duration: 10,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
    });
    
    await manager.executeGate(
      { name: '1', type: 'test-stats' },
      { workdir: process.cwd(), data: { shouldFail: false } },
    );
    
    await manager.executeGate(
      { name: '2', type: 'test-stats' },
      { workdir: process.cwd(), data: { shouldFail: true } },
    );
    
    const stats = manager.getStatistics();
    expect(stats.totalGates).toBe(2);
    expect(stats.passed).toBe(1);
    expect(stats.failed).toBe(1);
  });
});

describe('Gate Pipeline', () => {
  let manager: GateManager;
  
  beforeEach(() => {
    manager = createGateManager({
      stopOnFailure: false,
    });
    
    // Register custom test gates
    manager.register('pass-gate', async () => ({
      gateId: 'pass-gate',
      gateName: 'Pass Gate',
      gateType: 'custom',
      status: 'passed',
      passed: true,
      message: 'OK',
      issues: [],
      duration: 5,
      startedAt: Date.now(),
      endedAt: Date.now(),
    }));
    
    manager.register('fail-gate', async () => ({
      gateId: 'fail-gate',
      gateName: 'Fail Gate',
      gateType: 'custom',
      status: 'failed',
      passed: false,
      message: 'Failed',
      issues: [],
      duration: 5,
      startedAt: Date.now(),
      endedAt: Date.now(),
    }));
  });
  
  afterEach(() => {
    manager.dispose();
  });
  
  it('should execute pipeline sequentially', async () => {
    const pipeline: GatePipeline = {
      id: 'p1',
      name: 'Test Pipeline',
      gates: [
        { name: 'G1', type: 'pass-gate' },
        { name: 'G2', type: 'pass-gate' },
      ],
    };
    
    const result = await manager.executePipeline(pipeline);
    
    expect(result.passed).toBe(true);
    expect(result.gateResults).toHaveLength(2);
  });
  
  it('should mark pipeline as failed when a required gate fails', async () => {
    const pipeline: GatePipeline = {
      id: 'p2',
      name: 'Failing Pipeline',
      gates: [
        { name: 'G1', type: 'pass-gate', required: true },
        { name: 'G2', type: 'fail-gate', required: true },
      ],
    };
    
    const result = await manager.executePipeline(pipeline, {
      workdir: process.cwd(),
    });
    
    expect(result.passed).toBe(false);
    expect(result.failedGates).toContain('fail-gate');
  });
  
  it('should execute gates in parallel', async () => {
    const pipeline: GatePipeline = {
      id: 'p3',
      name: 'Parallel Pipeline',
      parallel: true,
      gates: [
        { name: 'G1', type: 'pass-gate' },
        { name: 'G2', type: 'pass-gate' },
        { name: 'G3', type: 'pass-gate' },
      ],
    };
    
    const result = await manager.executePipeline(pipeline);
    
    expect(result.passed).toBe(true);
    expect(result.gateResults).toHaveLength(3);
  });
  
  it('should pass with continueOnFailure', async () => {
    const pipeline: GatePipeline = {
      id: 'p4',
      name: 'Continue Pipeline',
      continueOnFailure: true,
      gates: [
        { name: 'G1', type: 'fail-gate', required: false },
        { name: 'G2', type: 'pass-gate' },
      ],
    };
    
    const result = await manager.executePipeline(pipeline);
    
    expect(result.gateResults).toHaveLength(2);
  });
  
  it('should count total issues', async () => {
    manager.register('issue-gate', async () => ({
      gateId: 'issue-gate',
      gateName: 'Issue',
      gateType: 'custom',
      status: 'failed',
      passed: false,
      message: 'Issues found',
      issues: [
        { severity: 'error', message: 'Error 1' },
        { severity: 'warning', message: 'Warning 1' },
      ],
      duration: 0,
      startedAt: Date.now(),
      endedAt: Date.now(),
    }));
    
    const pipeline: GatePipeline = {
      id: 'p5',
      name: 'Issue Pipeline',
      gates: [
        { name: 'I1', type: 'issue-gate' },
      ],
    };
    
    const result = await manager.executePipeline(pipeline);
    expect(result.totalIssues).toBe(2);
  });
});

describe('Built-in Gate Executors', () => {
  it('should have lintGateExecutor', () => {
    expect(typeof lintGateExecutor).toBe('function');
  });
  
  it('should have testGateExecutor', () => {
    expect(typeof testGateExecutor).toBe('function');
  });
  
  it('should have typeCheckGateExecutor', () => {
    expect(typeof typeCheckGateExecutor).toBe('function');
  });
  
  it('should execute lint with successful command', async () => {
    const result = await lintGateExecutor(
      {
        name: 'Lint',
        type: 'lint',
        command: 'node',
        args: ['-e', 'console.log("[]")'],
        timeout: 5000,
      },
      { workdir: process.cwd() },
    );
    
    expect(result.status).toBe('passed');
  });
  
  it('should execute typecheck with valid TypeScript', async () => {
    const result = await typeCheckGateExecutor(
      {
        name: 'Typecheck',
        type: 'typecheck',
        command: 'node',
        args: ['-e', 'console.log("")'],
        timeout: 5000,
      },
      { workdir: process.cwd() },
    );
    
    expect(result.status).toBe('passed');
  });
});