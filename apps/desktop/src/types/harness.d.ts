/**
 * DataFoundry Desktop - Harness Core API Types
 * 
 * TypeScript types for the window.dfd.harness API exposed via preload
 */

export interface HarnessInfoResult {
  hasHookBus: boolean;
  hasEventLog: boolean;
  hasPluginManager: boolean;
  hasRuntimeManager: boolean;
}

export interface EventLogStats {
  sessionId: string;
  runId?: string;
  totalEvents: number;
  eventCountByType: Record<string, number>;
}

export interface RuntimeStats {
  total: number;
  byType: {
    local: number;
    remote: number;
    enterprise: number;
  };
  byStatus: Record<string, number>;
  rules: number;
  strategy: string;
}

export interface HookBusStats {
  listenerCount: number;
  eventCount: number;
}

export interface PluginStats {
  totalPlugins: number;
  mountedPlugins: number;
  loadOrder: string[];
}

export interface HarnessAPI {
  /**
   * Get harness-core module info
   */
  getInfo(): Promise<{ ok: boolean; result?: HarnessInfoResult; error?: string }>;
  
  /**
   * Create a new SessionEventLog
   */
  createEventLog(options: {
    sessionId: string;
    runId?: string;
  }): Promise<{ ok: boolean; result?: EventLogStats; error?: string }>;
  
  /**
   * Create a RuntimeManager
   */
  createRuntimeManager(options?: {
    defaultType?: 'local' | 'remote' | 'enterprise';
  }): Promise<{ ok: boolean; result?: RuntimeStats; error?: string }>;
  
  /**
   * Create a HookBus
   */
  createHookBus(): Promise<{ ok: boolean; result?: HookBusStats; error?: string }>;
  
  /**
   * Create a PluginManager
   */
  createPluginManager(): Promise<{ ok: boolean; result?: PluginStats; error?: string }>;
}

export interface DataFoundryDesktopAPI {
  getInfo(): Promise<{
    name: string;
    version: string;
    electron: string;
    chrome: string;
    node: string;
    apiPort: number | null;
    apiUrl: string | null;
    cwd: string;
    userData: string;
    logs: string;
  }>;
  
  openLogs(): Promise<string>;
  openRepo(): Promise<string>;
  restart(): Promise<void>;
  
  cdl: {
    run(payload: {
      regime?: string;
      phiSem?: number;
      phiCf?: number;
      uSem?: number;
      uCf?: number;
    }): Promise<{
      ok: boolean;
      result?: {
        alpha: number;
        u: number;
        J: number;
        theorem3: boolean;
        theorem3Gap: number | null;
      };
      error?: string;
    }>;
  };
  
  harness: HarnessAPI;
}

declare global {
  interface Window {
    dfd: DataFoundryDesktopAPI;
  }
}

export {};
