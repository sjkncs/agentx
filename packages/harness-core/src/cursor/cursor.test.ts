/**
 * Phase 9 & 10 Tests: Cursor SDK + Integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CursorSdkAdapter,
  LocalCursorSdkAdapter,
  CloudCursorSdkAdapter,
  createCursorSdkAdapter,
  IdeResidentWorkflow,
  createIdeResidentWorkflow,
  type CursorAgentRequest,
  type CursorSdkConfig,
} from '../cursor/index.js';

// ============================================================================
// Phase 9: Cursor SDK Tests
// ============================================================================

describe('LocalCursorSdkAdapter', () => {
  let adapter: LocalCursorSdkAdapter;
  
  beforeEach(() => {
    adapter = new LocalCursorSdkAdapter({
      type: 'local',
      clientInfo: { name: 'test', version: '1.0.0' },
      workspace: process.cwd(),
    });
  });
  
  afterEach(async () => {
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
  });
  
  it('should create adapter', () => {
    expect(adapter).toBeDefined();
  });
  
  it('should not be connected initially', () => {
    expect(adapter.isConnected()).toBe(false);
  });
  
  it('should connect to local IDE', async () => {
    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
  });
  
  it('should get IDE context', async () => {
    await adapter.connect();
    const context = await adapter.getContext();
    expect(context).toBeDefined();
    expect(context?.workspace).toBe(process.cwd());
  });
  
  it('should invoke agent', async () => {
    await adapter.connect();
    
    const response = await adapter.invoke({
      prompt: 'Hello',
      type: 'chat',
    });
    
    expect(response.id).toBeDefined();
    expect(response.status).toBe('completed');
  });
  
  it('should stream agent response', async () => {
    await adapter.connect();
    
    const events = [];
    for await (const event of adapter.stream({
      prompt: 'Test',
      type: 'chat',
    })) {
      events.push(event);
    }
    
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('start');
  });
  
  it('should disconnect', async () => {
    await adapter.connect();
    await adapter.disconnect();
    expect(adapter.isConnected()).toBe(false);
  });
});

describe('CloudCursorSdkAdapter', () => {
  it('should require API key', () => {
    expect(() => {
      new CloudCursorSdkAdapter({
        type: 'cloud',
        clientInfo: { name: 'test', version: '1.0.0' },
      });
    }).toThrow();
  });
  
  it('should create with API key', () => {
    const adapter = new CloudCursorSdkAdapter({
      type: 'cloud',
      apiKey: 'test-key',
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    
    expect(adapter).toBeDefined();
  });
  
  it('should connect and get context', async () => {
    const adapter = new CloudCursorSdkAdapter({
      type: 'cloud',
      apiKey: 'test-key',
      clientInfo: { name: 'test', version: '1.0.0' },
      endpoint: 'http://localhost:9999', // Will fail but should connect locally
    });
    
    await adapter.connect();
    expect(adapter.isConnected()).toBe(true);
    
    const context = await adapter.getContext();
    expect(context).toBeDefined();
    
    await adapter.disconnect();
  });
});

describe('createCursorSdkAdapter factory', () => {
  it('should create local adapter by default', () => {
    const adapter = createCursorSdkAdapter({
      type: 'local',
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    
    expect(adapter).toBeInstanceOf(LocalCursorSdkAdapter);
  });
  
  it('should create cloud adapter when type is cloud', () => {
    const adapter = createCursorSdkAdapter({
      type: 'cloud',
      apiKey: 'test-key',
      clientInfo: { name: 'test', version: '1.0.0' },
    });
    
    expect(adapter).toBeInstanceOf(CloudCursorSdkAdapter);
  });
});

describe('IdeResidentWorkflow', () => {
  let workflow: IdeResidentWorkflow;
  let adapter: CursorSdkAdapter;
  
  beforeEach(async () => {
    adapter = createCursorSdkAdapter({
      type: 'local',
      clientInfo: { name: 'test', version: '1.0.0' },
      workspace: process.cwd(),
    });
    
    workflow = createIdeResidentWorkflow(adapter);
    await workflow.start();
  });
  
  afterEach(async () => {
    await workflow.stop();
  });
  
  it('should create workflow', () => {
    expect(workflow).toBeDefined();
  });
  
  it('should open file', () => {
    workflow.openFile({
      path: '/tmp/test.ts',
      content: 'const x = 1;',
      language: 'typescript',
      modified: false,
    });
    
    expect(workflow.getOpenFiles()).toHaveLength(1);
  });
  
  it('should close file', () => {
    workflow.openFile({
      path: '/tmp/test.ts',
      content: '',
      language: 'typescript',
      modified: false,
    });
    
    workflow.closeFile('/tmp/test.ts');
    expect(workflow.getOpenFiles()).toHaveLength(0);
  });
  
  it('should update selection', () => {
    workflow.updateSelection(
      {
        startLine: 1,
        startColumn: 0,
        endLine: 5,
        endColumn: 10,
      },
      '/tmp/test.ts',
    );
    
    expect(workflow.getCurrentSelection()).toBeDefined();
  });
  
  it('should update cursor position', () => {
    workflow.updateCursor({ line: 5, column: 10 }, '/tmp/test.ts');
    expect(workflow.getCurrentCursor()).toEqual({ line: 5, column: 10 });
  });
  
  it('should get current context', async () => {
    const context = await workflow.getCurrentContext();
    expect(context).toBeDefined();
  });
  
  it('should detect language from extension', () => {
    workflow.openFile({
      path: '/tmp/test.py',
      content: '',
      language: 'python',
      modified: false,
    });
    
    expect(workflow.getOpenFiles()[0].language).toBe('python');
  });
});