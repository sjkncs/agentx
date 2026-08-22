/**
 * Phase 2: Session Event Log Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SessionEventLog,
  EventAnalytics,
  generateAnalyticsReport,
  TimelineRecorder,
  recordToolCall,
  deriveMessages,
  deriveToolTrajectory,
  deriveSessionSummary,
  type SessionEvent,
} from '../session/index.js';

describe('SessionEventLog', () => {
  let eventLog: SessionEventLog;

  beforeEach(() => {
    eventLog = new SessionEventLog({
      sessionId: 'test-session-1',
      runId: 'test-run-1',
    });
  });

  it('should create a session event log', () => {
    expect(eventLog).toBeDefined();
    expect(eventLog.getEventCount()).toBe(0);
  });

  it('should append turn events', () => {
    eventLog.append({
      type: 'turn/start',
      turnId: 't1',
      timestamp: Date.now(),
      userInput: 'Hello',
    });
    eventLog.append({
      type: 'turn/end',
      turnId: 't1',
      timestamp: Date.now(),
      outcome: 'success',
    });

    const events = eventLog.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('turn/start');
    expect(events[1].type).toBe('turn/end');
  });

  it('should append step events', () => {
    eventLog.append({
      type: 'turn/start',
      turnId: 't1',
      timestamp: Date.now(),
    });
    eventLog.append({
      type: 'step/start',
      stepId: 's1',
      turnId: 't1',
      stepIndex: 0,
    });
    eventLog.append({
      type: 'step/end',
      stepId: 's1',
      turnId: 't1',
      stats: { toolCalls: 0, totalDuration: 0, tokensUsed: 0, errors: 0 },
    });
    eventLog.append({
      type: 'turn/end',
      turnId: 't1',
      timestamp: Date.now(),
      outcome: 'success',
    });

    expect(eventLog.getEvents()).toHaveLength(4);
  });

  it('should append tool call events', () => {
    eventLog.append({
      type: 'tool/call',
      toolName: 'read_file',
      input: { path: '/test.txt' },
      stepId: 's1',
      turnId: 't1',
    });
    eventLog.append({
      type: 'tool/result',
      toolName: 'read_file',
      output: { content: 'hello' },
      stepId: 's1',
      turnId: 't1',
      duration: 100,
    });

    const events = eventLog.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('tool/call');
    expect((events[0] as any).toolName).toBe('read_file');
  });

  it('should append LLM call events', () => {
    eventLog.append({
      type: 'llm.request',
      toolName: 'claude-3-5-sonnet',
      input: { tokens: 100 },
      stepId: 's1',
      turnId: 't1',
    });

    const events = eventLog.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('llm.request');
  });

  it('should derive messages', () => {
    eventLog.append({
      type: 'user/message',
      content: 'Hello',
      turnId: 't1',
      timestamp: Date.now(),
    });
    eventLog.append({
      type: 'assistant/message',
      content: 'Hi there!',
      turnId: 't1',
      timestamp: Date.now(),
    });

    const messages = deriveMessages([...eventLog.getEvents()]);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });

  it('should derive tool trajectory', () => {
    eventLog.append({
      type: 'tool/call',
      toolName: 'tool1',
      input: {},
      stepId: 's1',
      turnId: 't1',
    });
    eventLog.append({
      type: 'tool/call',
      toolName: 'tool2',
      input: {},
      stepId: 's1',
      turnId: 't1',
    });

    const trajectory = deriveToolTrajectory([...eventLog.getEvents()]);
    expect(trajectory).toHaveLength(2);
    expect(trajectory[0].toolName).toBe('tool1');
    expect(trajectory[1].toolName).toBe('tool2');
  });

  it('should derive session summary', () => {
    eventLog.append({
      type: 'turn/start',
      turnId: 't1',
      timestamp: Date.now(),
    });
    eventLog.append({
      type: 'turn/end',
      turnId: 't1',
      timestamp: Date.now(),
      outcome: 'success',
    });

    const summary = deriveSessionSummary([...eventLog.getEvents()]);
    expect(summary.turnCount).toBe(1);
    expect(summary.duration).toBeGreaterThanOrEqual(0);
  });

  it('should get stats', () => {
    eventLog.append({
      type: 'turn/start',
      turnId: 't1',
      timestamp: Date.now(),
    });
    eventLog.append({
      type: 'turn/end',
      turnId: 't1',
      timestamp: Date.now(),
      outcome: 'success',
    });

    const stats = eventLog.getStats();
    expect(stats.totalEvents).toBe(2);
    expect(stats.byType['turn/start']).toBe(1);
    expect(stats.byType['turn/end']).toBe(1);
  });

  it('should clear events on dispose', () => {
    eventLog.append({
      type: 'turn/start',
      turnId: 't1',
      timestamp: Date.now(),
    });
    eventLog.dispose();

    expect(eventLog.getEvents()).toHaveLength(0);
  });

  it('should fork session', () => {
    eventLog.append({
      type: 'turn/start',
      turnId: 't1',
      timestamp: Date.now(),
    });
    
    const childSessionId = eventLog.fork('parent-session');
    
    expect(childSessionId).toMatch(/^fork-/);
    expect(eventLog.getEventCount()).toBeGreaterThan(1);
  });
});

describe('EventAnalytics', () => {
  let events: SessionEvent[];

  beforeEach(() => {
    const eventLog = new SessionEventLog({
      sessionId: 'analytics-test',
      runId: 'run-1',
    });

    eventLog.append({
      type: 'turn/start',
      turnId: 't1',
      timestamp: Date.now(),
    });
    eventLog.append({
      type: 'step/start',
      stepId: 's1',
      turnId: 't1',
      stepIndex: 0,
    });
    eventLog.append({
      type: 'tool/call',
      toolName: 'read_file',
      input: {},
      stepId: 's1',
      turnId: 't1',
    });
    eventLog.append({
      type: 'tool/result',
      toolName: 'read_file',
      output: {},
      stepId: 's1',
      turnId: 't1',
      duration: 50,
    });
    eventLog.append({
      type: 'tool/call',
      toolName: 'read_file',
      input: {},
      stepId: 's1',
      turnId: 't1',
    });
    eventLog.append({
      type: 'tool/result',
      toolName: 'read_file',
      output: {},
      stepId: 's1',
      turnId: 't1',
      duration: 60,
    });
    eventLog.append({
      type: 'tool/call',
      toolName: 'write_file',
      input: {},
      stepId: 's1',
      turnId: 't1',
    });
    eventLog.append({
      type: 'tool/result',
      toolName: 'write_file',
      output: {},
      stepId: 's1',
      turnId: 't1',
      duration: 40,
    });
    eventLog.append({
      type: 'turn/end',
      turnId: 't1',
      timestamp: Date.now(),
      outcome: 'success',
    });

    events = [...eventLog.getEvents()];
  });

  it('should analyze events', () => {
    const analytics = EventAnalytics.analyze(events);

    expect(analytics.eventCounts['turn/start']).toBe(1);
    expect(analytics.turnStats.totalTurns).toBe(1);
  });

  it('should calculate turn stats', () => {
    const analytics = EventAnalytics.analyze(events);

    expect(analytics.turnStats.totalTurns).toBe(1);
    expect(analytics.turnStats.successfulTurns).toBe(1);
    expect(analytics.turnStats.failedTurns).toBe(0);
  });

  it('should calculate tool usage stats', () => {
    const analytics = EventAnalytics.analyze(events);

    const readFileTool = analytics.toolUsage.find(t => t.toolName === 'read_file');
    expect(readFileTool).toBeDefined();
    expect(readFileTool!.totalCalls).toBe(2);
    expect(readFileTool!.successCalls).toBe(2);
  });

  it('should generate report', () => {
    const analytics = EventAnalytics.analyze(events);
    const report = generateAnalyticsReport(analytics);

    expect(report).toContain('Session Analytics');
    expect(report).toContain('Total Turns');
  });
});

describe('TimelineRecorder', () => {
  let eventLog: SessionEventLog;
  let timeline: TimelineRecorder;

  beforeEach(() => {
    eventLog = new SessionEventLog({
      sessionId: 'timeline-test',
      runId: 'run-1',
    });
    timeline = new TimelineRecorder(eventLog, {
      sessionId: 'timeline-test',
      runId: 'run-1',
    });
  });

  it('should create timeline recorder', () => {
    expect(timeline).toBeDefined();
  });

  it('should start and end entries', () => {
    const entryId = timeline.startEntry('step', { input: 'test' });
    expect(entryId).toBeDefined();

    timeline.endEntry(entryId, { output: 'result' });

    const tree = timeline.getTree();
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].status).toBe('completed');
  });

  it('should track nested entries', () => {
    const stepId = timeline.startEntry('step', { input: 'test' });
    
    const llmId = timeline.startEntry('llm_call', { model: 'claude' });
    timeline.endEntry(llmId, { tokens: 100 });
    
    const toolId = timeline.startEntry('tool_call', { toolName: 'read_file' });
    timeline.endEntry(toolId, {});
    
    timeline.endEntry(stepId, {});

    const tree = timeline.getTree();
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].children.length).toBeGreaterThanOrEqual(2);
  });

  it('should record tool calls', async () => {
    const result = await recordToolCall(
      timeline,
      'read_file',
      async () => ({ content: 'file content' }),
      { path: '/test.txt' }
    );

    expect(result).toEqual({ content: 'file content' });
  });

  it('should get tree structure', () => {
    const stepId = timeline.startEntry('step', {});
    timeline.endEntry(stepId, {});

    const tree = timeline.getTree();
    expect(tree.type).toBe('session');
    expect(tree.children[0].type).toBe('step');
  });

  it('should export to JSON', () => {
    const stepId = timeline.startEntry('step', {});
    timeline.endEntry(stepId, {});

    const json = timeline.toJSON();
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe('session');
    expect(parsed.children).toHaveLength(1);
  });
});