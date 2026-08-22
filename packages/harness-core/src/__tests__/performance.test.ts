/**
 * Performance Tests - 性能基准测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SubagentManager,
  Orchestrator,
  createSubagentManager,
  createOrchestrator,
  VmSandbox,
  SandboxManager,
  GateManager,
  createGateManager,
  SessionEventLog,
  HookBus,
} from '../index.js';

describe('Performance Benchmarks', () => {
  describe('Subagent Performance', () => {
    it('should spawn 100 subagents quickly', async () => {
      const manager = createSubagentManager({ maxConcurrent: 200 });
      
      const startTime = Date.now();
      
      for (let i = 0; i < 100; i++) {
        manager.spawn('session', {
          role: 'worker',
          prompt: `Task ${i}`,
        });
      }
      
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(1000); // < 1s
      expect(manager.getAll()).toHaveLength(100);
      
      await manager.dispose();
    });
    
    it('should query subagents efficiently', () => {
      const manager = createSubagentManager({ maxConcurrent: 200 });
      
      // Spawn many subagents
      for (let i = 0; i < 50; i++) {
        manager.spawn('session', {
          role: i % 2 === 0 ? 'worker' : 'researcher',
          prompt: `Task ${i}`,
        });
      }
      
      const startTime = Date.now();
      const workers = manager.getByRole('worker');
      const researchers = manager.getByRole('researcher');
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(100); // < 100ms
      expect(workers.length).toBeGreaterThan(0);
      expect(researchers.length).toBeGreaterThan(0);
      
      manager.dispose();
    });
  });
  
  describe('Sandbox Performance', () => {
    it('should execute code quickly', async () => {
      const sandbox = new VmSandbox({ type: 'vm' });
      await sandbox.start();
      
      const startTime = Date.now();
      
      await sandbox.execute({
        code: 'Math.sqrt(144)',
      });
      
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(500); // < 500ms
      
      await sandbox.destroy();
    });
    
    it('should handle multiple executions', async () => {
      const sandbox = new VmSandbox({ type: 'vm' });
      await sandbox.start();
      
      const startTime = Date.now();
      
      for (let i = 0; i < 20; i++) {
        await sandbox.execute({
          code: `${i} + ${i}`,
        });
      }
      
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(5000); // < 5s
      
      await sandbox.destroy();
    });
  });
  
  describe('Event Log Performance', () => {
    it('should handle 1000 events quickly', () => {
      const log = new SessionEventLog({ workdir: process.cwd() });
      
      const startTime = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        log.append({
          type: 'test',
          data: { index: i },
        });
      }
      
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(5000); // < 5s
    });
  });
  
  describe('Hook Performance', () => {
    it('should dispatch 1000 hooks quickly', async () => {
      const bus = new HookBus();
      
      let count = 0;
      bus.register(
        { name: 'perf-test', events: ['agent.start'], action: { type: 'prompt', template: '' } },
        async () => {
          count++;
        }
      );
      
      const startTime = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        await bus.emit('agent.start', {
          event: 'agent.start',
          sessionId: 's1',
          runId: 'r1',
          payload: { index: i },
          metadata: {},
        });
      }
      
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(5000); // < 5s
      expect(count).toBe(1000);
    });
  });
  
  describe('Gate Performance', () => {
    it('should execute custom gate quickly', async () => {
      const manager = createGateManager();
      
      manager.register('fast-gate', async () => ({
        gateId: 'fast-gate',
        gateName: 'Fast Gate',
        gateType: 'custom',
        status: 'passed',
        passed: true,
        message: 'OK',
        issues: [],
        duration: 0,
        startedAt: Date.now(),
        endedAt: Date.now(),
      }));
      
      const startTime = Date.now();
      
      for (let i = 0; i < 100; i++) {
        await manager.executeGate(
          { name: 'Fast', type: 'fast-gate' },
          { workdir: process.cwd() },
        );
      }
      
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(5000); // < 5s
      
      manager.dispose();
    });
  });
  
  describe('Orchestration Performance', () => {
    it('should handle large orchestration', async () => {
      const subagentManager = createSubagentManager({ maxConcurrent: 20 });
      const orchestrator = createOrchestrator(subagentManager);
      
      const startTime = Date.now();
      
      await orchestrator.execute({
        id: 'large',
        name: 'Large',
        mode: 'parallel',
        tasks: Array.from({ length: 20 }, (_, i) => ({
          id: `task-${i}`,
          name: `Task ${i}`,
          subagent: { role: 'worker', prompt: `Task ${i}` },
        })),
      });
      
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(60000); // < 60s
      
      await subagentManager.dispose();
    });
  });
});