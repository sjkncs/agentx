/**
 * Phase 8: Gate Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  GateManager,
  createGateManager,
  lintGateExecutor,
  testGateExecutor,
  typeCheckGateExecutor,
  buildGateExecutor,
  formatGateExecutor,
  coverageGateExecutor,
  GateExecutionError,
  GateTimeoutError,
  type GateConfig,
  type GateContext,
  type GatePipeline,
} from '../index.js';

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
    manager.register('custom-1', async () => ({
      gateId: 'custom-1',
      gateName: 'Custom',
      gateType: 'custom',
      status: 'passed',
      passed: true,
      message: 'OK',
      issues: [],
      duration: 0,
      startedAt: Date.now(),
      endedAt: Date.now(),
    }));
    
    expect(manager.getSupportedTypes()).toContain('custom-1');
  });

  it('should unregister executor', () => {
    manager.register('to-remove', async () => ({
      gateId: 'to-remove',
      gateName: 'To Remove',
      gateType: 'custom',
      status: 'passed',
      passed: true,
      message: 'OK',
      issues: [],
      duration: 0,
      startedAt: Date.now(),
      endedAt: Date.now(),
    }));

    expect(manager.unregister('to-remove')).toBe(true);
    expect(manager.unregister('non-existent')).toBe(false);
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

  it('should reject unknown gate type', async () => {
    await expect(
      manager.executeGate(
        { name: 'Unknown', type: 'unknown-type-xxx' as any },
        { workdir: process.cwd() },
      ),
    ).rejects.toThrow(GateExecutionError);
  });

  it('should track execution history', async () => {
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
      { name: 'H1', type: 'test-history' },
      { workdir: process.cwd() },
    );

    await manager.executeGate(
      { name: 'H2', type: 'test-history' },
      { workdir: process.cwd() },
    );

    expect(manager.getHistory()).toHaveLength(2);
  });

  it('should skip when skipIf returns true', async () => {
    manager.register('test-skip', async () => ({
      gateId: 'test-skip',
      gateName: 'Skip',
      gateType: 'custom',
      status: 'passed',
      passed: true,
      message: 'Should not run',
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
    expect(result.passed).toBe(true);
  });

  it('should skip when async skipIf resolves to true', async () => {
    manager.register('test-skip-async', async () => ({
      gateId: 'test-skip-async',
      gateName: 'Skip Async',
      gateType: 'custom',
      status: 'passed',
      passed: true,
      message: 'Should not run',
      issues: [],
      duration: 0,
      startedAt: Date.now(),
      endedAt: Date.now(),
    }));

    const result = await manager.executeGate(
      {
        name: 'Skip Async',
        type: 'test-skip-async',
        skipIf: async () => true,
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
    expect(result.retries).toBeGreaterThanOrEqual(1);
  });

  it('should give up after max retries', async () => {
    let attempts = 0;
    manager.register('test-retry-fail', async () => {
      attempts++;
      return {
        gateId: 'test-retry-fail',
        gateName: 'Retry Fail',
        gateType: 'custom',
        status: 'failed',
        passed: false,
        message: 'Always fails',
        issues: [],
        duration: 0,
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
    });

    const result = await manager.executeGate(
      {
        name: 'Always Fail',
        type: 'test-retry-fail',
        required: true,
        retries: 2,
        retryDelay: 10,
      },
      { workdir: process.cwd() },
    );

    expect(result.passed).toBe(false);
    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  it('should handle executor errors gracefully', async () => {
    manager.register('test-error', async () => {
      throw new Error('Executor crashed');
    });

    const result = await manager.executeGate(
      {
        name: 'Error',
        type: 'test-error',
        required: true,
        retries: 0,
      },
      { workdir: process.cwd() },
    );

    expect(result.status).toBe('error');
    expect(result.error).toContain('Executor crashed');
  });

  it('should get statistics', async () => {
    manager.register('test-stats', async (config, context) => {
      const shouldFail = (context.data?.count || 0) > 1;
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
      { workdir: process.cwd(), data: { count: 1 } },
    );

    await manager.executeGate(
      { name: '2', type: 'test-stats' },
      { workdir: process.cwd(), data: { count: 2 } },
    );

    const stats = manager.getStatistics();
    expect(stats.totalGates).toBe(2);
    expect(stats.passed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.averageDuration).toBeGreaterThanOrEqual(0);
  });

  it('should clear history', async () => {
    manager.register('clear-test', async () => ({
      gateId: 'clear-test',
      gateName: 'Clear',
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
      { name: 'C', type: 'clear-test' },
      { workdir: process.cwd() },
    );

    expect(manager.getHistory()).toHaveLength(1);
    manager.clearHistory();
    expect(manager.getHistory()).toHaveLength(0);
  });
});

describe('Gate Pipeline', () => {
  let manager: GateManager;

  beforeEach(() => {
    manager = createGateManager({
      stopOnFailure: false,
    });
    
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

  it('should fail pipeline when required gate fails', async () => {
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

  it('should track duration', async () => {
    const pipeline: GatePipeline = {
      id: 'p-duration',
      name: 'Duration Pipeline',
      gates: [
        { name: 'G1', type: 'pass-gate' },
      ],
    };

    const result = await manager.executePipeline(pipeline);

    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.startedAt).toBeDefined();
    expect(result.endedAt).toBeGreaterThanOrEqual(result.startedAt);
  });

  it('should track skipped gates', async () => {
    const pipeline: GatePipeline = {
      id: 'p-skip',
      name: 'Skip Pipeline',
      gates: [
        { 
          name: 'G1', 
          type: 'pass-gate',
          skipIf: () => true,
        },
      ],
    };

    const result = await manager.executePipeline(pipeline);

    expect(result.skippedGates).toHaveLength(1);
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

  it('should have buildGateExecutor', () => {
    expect(typeof buildGateExecutor).toBe('function');
  });

  it('should have formatGateExecutor', () => {
    expect(typeof formatGateExecutor).toBe('function');
  });

  it('should have coverageGateExecutor', () => {
    expect(typeof coverageGateExecutor).toBe('function');
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
    expect(result.gateType).toBe('lint');
  });

  it('should execute typecheck', async () => {
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

    expect(result.gateType).toBe('typecheck');
  });
});