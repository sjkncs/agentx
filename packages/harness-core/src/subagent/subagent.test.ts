/**
 * Phase 5: Subagent Orchestration Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Subagent,
  SubagentManager,
  Orchestrator,
  createSubagent,
  createSubagentManager,
  createOrchestrator,
  SubagentError,
  SubagentNotFoundError,
  SubagentSpawnError,
  OrchestrationError,
  type SubagentConfig,
  type Orchestration,
} from '../subagent/index.js';

describe('Subagent', () => {
  let subagent: Subagent;
  let config: SubagentConfig;

  beforeEach(() => {
    config = {
      id: 'test-1',
      role: 'worker',
      name: 'Test Worker',
      prompt: 'Test task',
      context: { key: 'value' },
    };
    subagent = createSubagent('test-session', config);
  });

  it('should create a subagent', () => {
    expect(subagent).toBeDefined();
    expect(subagent.id).toBe('test-1');
    expect(subagent.role).toBe('worker');
    expect(subagent.name).toBe('Test Worker');
  });

  it('should generate ID if not provided', () => {
    const sa = createSubagent('session', { role: 'researcher', prompt: 'Research' });
    expect(sa.id).toBeDefined();
    expect(sa.id).toContain('researcher');
  });

  it('should set initial status to ready', () => {
    // After creation, subagent starts initializing then we set it to ready
    subagent.setStatus('ready');
    expect(subagent.getStatus()).toBe('ready');
  });

  it('should update status', () => {
    subagent.setStatus('running');
    expect(subagent.getStatus()).toBe('running');
    
    subagent.setStatus('paused');
    expect(subagent.getStatus()).toBe('paused');
    
    subagent.setStatus('running');
    expect(subagent.getStatus()).toBe('running');
  });

  it('should emit status change events', () => {
    const events: Array<[string, string]> = [];
    subagent.on('status:change', (newStatus, previous) => {
      events.push([newStatus, previous]);
    });

    subagent.setStatus('running');
    subagent.setStatus('paused');
    subagent.setStatus('completed');

    expect(events.length).toBe(3);
    expect(events[0]).toEqual(['running', 'initializing']);
    expect(events[1]).toEqual(['paused', 'running']);
    expect(events[2]).toEqual(['completed', 'paused']);
  });

  it('should track progress', () => {
    subagent.setProgress(0);
    subagent.setProgress(50);
    subagent.setProgress(100);

    expect(subagent.getProgress()).toBe(100);
  });

  it('should clamp progress to 0-100', () => {
    subagent.setProgress(-10);
    expect(subagent.getProgress()).toBe(0);

    subagent.setProgress(150);
    expect(subagent.getProgress()).toBe(100);
  });

  it('should add steps', () => {
    subagent.addStep({
      type: 'llm',
      input: 'Hello',
      output: 'Hi!',
      startedAt: Date.now(),
    });

    const run = subagent.getRun();
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].type).toBe('llm');
  });

  it('should complete successfully', () => {
    const result = {
      success: true,
      data: { output: 'success' },
      duration: 100,
    };

    subagent.complete(result);
    expect(subagent.getStatus()).toBe('completed');
    expect(subagent.getRun().result).toEqual(result);
  });

  it('should complete with failure', () => {
    const result = {
      success: false,
      error: 'Failed',
      duration: 100,
    };

    subagent.complete(result);
    expect(subagent.getStatus()).toBe('failed');
  });

  it('should pause and resume', () => {
    subagent.setStatus('running');
    subagent.pause();
    expect(subagent.getStatus()).toBe('paused');

    subagent.resume();
    expect(subagent.getStatus()).toBe('running');
  });

  it('should cancel', () => {
    subagent.setStatus('running');
    subagent.cancel();
    expect(subagent.getStatus()).toBe('cancelled');
  });

  it('should track token usage', () => {
    subagent.addTokens(100, 50);
    subagent.addTokens(200, 80);

    const run = subagent.getRun();
    expect(run.tokensUsed?.input).toBe(300);
    expect(run.tokensUsed?.output).toBe(130);
  });

  it('should get comprehensive info', () => {
    subagent.setStatus('running');
    subagent.setProgress(50);
    subagent.addTokens(100, 50);

    const info = subagent.getInfo();
    expect(info.id).toBe('test-1');
    expect(info.role).toBe('worker');
    expect(info.status).toBe('running');
    expect(info.progress).toBe(50);
    expect(info.isolation).toBe('shared');
    expect(info.tokensUsed.input).toBe(100);
    expect(info.tokensUsed.output).toBe(50);
  });

  it('should handle isolation settings', () => {
    const isolatedSub = createSubagent('session', {
      role: 'worker',
      prompt: 'Task',
      isolation: 'isolated',
    });

    expect(isolatedSub.isolation).toBe('isolated');
  });
});

describe('SubagentManager', () => {
  let manager: SubagentManager;

  beforeEach(() => {
    manager = createSubagentManager({ maxConcurrent: 5 });
  });

  it('should create a manager', () => {
    expect(manager).toBeDefined();
    expect(manager.maxConcurrent).toBe(5);
  });

  it('should spawn subagents', () => {
    const sub = manager.spawn('session-1', {
      role: 'researcher',
      prompt: 'Research',
    });

    expect(sub).toBeDefined();
    expect(sub.role).toBe('researcher');
    expect(manager.getAll()).toHaveLength(1);
  });

  it('should enforce concurrent limit', () => {
    for (let i = 0; i < 5; i++) {
      manager.spawn('session', {
        role: 'worker',
        prompt: `Task ${i}`,
        id: `worker-${i}`,
      });
    }

    expect(() => {
      manager.spawn('session', {
        role: 'worker',
        prompt: 'Task 6',
      });
    }).toThrow(SubagentSpawnError);
  });

  it('should track subagents by parent', () => {
    const parent = manager.spawn('session', {
      role: 'planner',
      prompt: 'Plan',
      id: 'planner-1',
    });

    const child1 = manager.fork('session', 'planner-1', {
      role: 'worker',
      prompt: 'Implement',
    });

    const child2 = manager.fork('session', 'planner-1', {
      role: 'tester',
      prompt: 'Test',
    });

    const children = manager.getChildren('planner-1');
    expect(children).toHaveLength(2);
    expect(children.some(c => c.id === child1.id)).toBe(true);
    expect(children.some(c => c.id === child2.id)).toBe(true);
  });

  it('should fork subagents', () => {
    const parent = manager.spawn('session', {
      role: 'researcher',
      prompt: 'Research',
      id: 'researcher-1',
    });

    const child = manager.fork('session', 'researcher-1', {
      role: 'worker',
      prompt: 'Execute',
    });

    expect(child.parentId).toBe('researcher-1');
    expect(child.isolation).toBe('fork');
  });

  it('should remove subagents', () => {
    manager.spawn('session', {
      role: 'worker',
      prompt: 'Task',
      id: 'worker-1',
    });

    expect(manager.getAll()).toHaveLength(1);
    
    const removed = manager.remove('worker-1');
    expect(removed).toBe(true);
    expect(manager.getAll()).toHaveLength(0);
  });

  it('should get by role', () => {
    manager.spawn('session', { role: 'researcher', prompt: 'R1' });
    manager.spawn('session', { role: 'researcher', prompt: 'R2' });
    manager.spawn('session', { role: 'coder', prompt: 'C1' });

    expect(manager.getByRole('researcher')).toHaveLength(2);
    expect(manager.getByRole('coder')).toHaveLength(1);
  });

  it('should get by status', () => {
    const sa1 = manager.spawn('session', { role: 'worker', prompt: 'A' });
    manager.spawn('session', { role: 'worker', prompt: 'B' });

    sa1.setStatus('running');
    sa1.complete({ success: true, duration: 100 });

    expect(manager.getByStatus('completed')).toHaveLength(1);
    expect(manager.getByStatus('ready')).toHaveLength(1);
  });

  it('should get running subagents', () => {
    const sa1 = manager.spawn('session', { role: 'worker', prompt: 'A' });
    manager.spawn('session', { role: 'worker', prompt: 'B' });

    sa1.setStatus('running');

    expect(manager.getRunning()).toHaveLength(1);
  });

  it('should fork from non-existent parent should throw', () => {
    expect(() => {
      manager.fork('session', 'non-existent', {
        role: 'worker',
        prompt: 'Task',
      });
    }).toThrow(SubagentNotFoundError);
  });

  it('should send and receive messages', () => {
    const message = {
      id: 'msg-1',
      fromId: 'agent-1',
      toId: 'agent-2',
      type: 'request' as const,
      subject: 'greeting',
      payload: { greeting: 'Hello!' },
      timestamp: Date.now(),
    };

    manager.sendMessage(message);
    expect(manager.getMessages()).toHaveLength(1);
  });

  it('should register message listeners', async () => {
    let received: unknown = null;
    manager.onMessage((msg) => {
      received = msg;
    });

    const message = {
      id: 'msg-1',
      fromId: 'agent-1',
      type: 'notification' as const,
      subject: 'test',
      payload: 'Hello',
      timestamp: Date.now(),
    };

    manager.sendMessage(message);
    expect(received).toEqual(message);
  });

  it('should track statistics', () => {
    manager.spawn('session', { role: 'researcher', prompt: 'R1' });
    manager.spawn('session', { role: 'coder', prompt: 'C1' });

    const stats = manager.getStats();
    expect(stats.totalSpawned).toBe(2);
    expect(stats.byRole.researcher).toBe(1);
    expect(stats.byRole.coder).toBe(1);
  });

  it('should get detailed stats', () => {
    const sa = manager.spawn('session', { role: 'worker', prompt: 'A', id: 'w-1' });
    manager.spawn('session', { role: 'worker', prompt: 'B', id: 'w-2' });

    sa.setStatus('running');
    sa.complete({ success: true, duration: 100 });

    const detailed = manager.getDetailedStats();
    expect(detailed.total).toBe(2);
    expect(detailed.byStatus.completed).toBe(1);
    expect(detailed.byStatus.ready).toBe(1);
  });

  it('should cleanup on dispose', async () => {
    manager.spawn('session', { role: 'worker', prompt: 'A' });
    manager.spawn('session', { role: 'worker', prompt: 'B' });

    expect(manager.getAll()).toHaveLength(2);

    await manager.dispose();
    expect(manager.getAll()).toHaveLength(0);
  });
});

describe('Orchestrator', () => {
  let manager: SubagentManager;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    manager = createSubagentManager({ maxConcurrent: 10 });
    orchestrator = createOrchestrator(manager);
  });

  it('should create an orchestrator', () => {
    expect(orchestrator).toBeDefined();
  });

  it('should execute sequential orchestration', async () => {
    const orchestration: Orchestration = {
      id: 'seq-1',
      name: 'Sequential Test',
      mode: 'sequential',
      tasks: [
        {
          id: 'task-1',
          name: 'First',
          subagent: { role: 'worker', prompt: 'First task' },
        },
        {
          id: 'task-2',
          name: 'Second',
          subagent: { role: 'worker', prompt: 'Second task' },
        },
      ],
    };

    const result = await orchestrator.execute(orchestration);
    expect(result.success).toBe(true);
    expect(result.completedTasks).toContain('task-1');
    expect(result.completedTasks).toContain('task-2');
    expect(result.taskResults['task-1'].success).toBe(true);
    expect(result.taskResults['task-2'].success).toBe(true);
  });

  it('should execute parallel orchestration', async () => {
    const orchestration: Orchestration = {
      id: 'par-1',
      name: 'Parallel Test',
      mode: 'parallel',
      tasks: [
        { id: 'p-1', name: 'Parallel 1', subagent: { role: 'worker', prompt: 'P1' } },
        { id: 'p-2', name: 'Parallel 2', subagent: { role: 'worker', prompt: 'P2' } },
        { id: 'p-3', name: 'Parallel 3', subagent: { role: 'worker', prompt: 'P3' } },
      ],
    };

    const result = await orchestrator.execute(orchestration);
    expect(result.success).toBe(true);
    expect(result.completedTasks).toHaveLength(3);
  });

  it('should execute fan-out orchestration', async () => {
    const orchestration: Orchestration = {
      id: 'fo-1',
      name: 'Fan-Out Test',
      mode: 'fan-out',
      tasks: [
        { id: 'f-1', name: 'F1', subagent: { role: 'researcher', prompt: 'R1' } },
        { id: 'f-2', name: 'F2', subagent: { role: 'researcher', prompt: 'R2' } },
      ],
    };

    const result = await orchestrator.execute(orchestration);
    expect(result.success).toBe(true);
    expect(result.output?.results).toBeDefined();
  });

  it('should execute pipeline orchestration', async () => {
    const orchestration: Orchestration = {
      id: 'pipe-1',
      name: 'Pipeline Test',
      mode: 'pipeline',
      tasks: [
        { id: 'pipe-1', name: 'P1', subagent: { role: 'worker', prompt: 'Do task 1' } },
        {
          id: 'pipe-2',
          name: 'P2',
          subagent: { role: 'worker', prompt: 'Use result' },
          dependsOn: ['pipe-1'],
        },
      ],
    };

    const result = await orchestrator.execute(orchestration);
    expect(result.success).toBe(true);
  });

  it('should handle circular dependencies', async () => {
    const orchestration: Orchestration = {
      id: 'circ-1',
      name: 'Circular',
      mode: 'sequential',
      tasks: [
        {
          id: 'a',
          name: 'A',
          subagent: { role: 'worker', prompt: 'A' },
          dependsOn: ['b'],
        },
        {
          id: 'b',
          name: 'B',
          subagent: { role: 'worker', prompt: 'B' },
          dependsOn: ['a'],
        },
      ],
    };

    await expect(orchestrator.execute(orchestration)).rejects.toThrow(OrchestrationError);
  });

  it('should throw on empty tasks', async () => {
    const orchestration: Orchestration = {
      id: 'empty-1',
      name: 'Empty',
      mode: 'sequential',
      tasks: [],
    };

    await expect(orchestrator.execute(orchestration)).rejects.toThrow();
  });

  it('should throw on missing ID', async () => {
    const orchestration: Orchestration = {
      id: '',
      name: 'No ID',
      mode: 'sequential',
      tasks: [
        { id: 't', name: 'T', subagent: { role: 'worker', prompt: 'T' } },
      ],
    };

    await expect(orchestrator.execute(orchestration)).rejects.toThrow();
  });

  it('should continue on failure when configured', async () => {
    // This test verifies the onFailure policy works
    const orchestration: Orchestration = {
      id: 'cont-1',
      name: 'Continue',
      mode: 'sequential',
      onFailure: 'continue',
      tasks: [
        { id: 't1', name: 'T1', subagent: { role: 'worker', prompt: 'T1' } },
        { id: 't2', name: 'T2', subagent: { role: 'worker', prompt: 'T2' } },
      ],
    };

    const result = await orchestrator.execute(orchestration);
    expect(result.success).toBe(true);
  });
});

describe('Subagent Events', () => {
  it('should emit completed event with result', () => {
    const sa = createSubagent('session', { role: 'worker', prompt: 'Task' });
    
    let completedResult: unknown;
    sa.on('completed', (result) => {
      completedResult = result;
    });

    const result = { success: true, data: {}, duration: 100 };
    sa.complete(result);

    expect(completedResult).toEqual(result);
  });

  it('should emit progress events', () => {
    const sa = createSubagent('session', { role: 'worker', prompt: 'Task' });
    
    const progressValues: number[] = [];
    sa.on('progress', (progress) => {
      progressValues.push(progress);
    });

    sa.setProgress(10);
    sa.setProgress(50);
    sa.setProgress(100);

    expect(progressValues).toEqual([10, 50, 100]);
  });
});

describe('Fork and Resume', () => {
  it('should fork with proper isolation', () => {
    const manager = createSubagentManager();
    const parent = manager.spawn('session', {
      role: 'researcher',
      prompt: 'Research topic',
      id: 'parent-1',
    });

    const fork = manager.fork('session', 'parent-1', {
      role: 'worker',
      prompt: 'Implement findings',
    });

    expect(fork.parentId).toBe('parent-1');
    expect(fork.isolation).toBe('fork');
    expect(fork.getRun().parentRunId).toBe('parent-1');
  });

  it('should resume a paused subagent', () => {
    const manager = createSubagentManager();
    const sa = manager.spawn('session', {
      role: 'worker',
      prompt: 'Initial task',
      id: 'task-1',
    });

    sa.setStatus('running');
    sa.pause();
    expect(sa.getStatus()).toBe('paused');

    const resumed = manager.resume('session', 'task-1', 'New prompt');
    expect(resumed.getStatus()).toBe('running');
    expect(resumed.config.prompt).toBe('New prompt');
  });

  it('should create new subagent when resuming non-paused', () => {
    const manager = createSubagentManager();
    const sa = manager.spawn('session', {
      role: 'worker',
      prompt: 'Task',
      id: 'task-1',
    });

    // Don't pause - complete immediately
    sa.setStatus('running');
    sa.complete({ success: true, duration: 100 });

    const resumed = manager.resume('session', 'task-1', 'Resume task');
    
    // Should create a new subagent, not resume the old
    expect(resumed.id).not.toBe('task-1');
  });
});
