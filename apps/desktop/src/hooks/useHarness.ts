/**
 * Harness Core React Hooks
 * 
 * React hooks for using Harness Core in the renderer
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { 
  HarnessInfoResult, 
  EventLogStats, 
  RuntimeStats, 
  HookBusStats, 
  PluginStats 
} from '../types/harness.d';

/**
 * Check if Harness Core is available
 */
export function useHarnessAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  
  useEffect(() => {
    setAvailable(typeof window !== 'undefined' && !!window.dfd?.harness);
  }, []);
  
  return available;
}

/**
 * Get Harness Core module info
 */
export function useHarnessInfo() {
  const [info, setInfo] = useState<HarnessInfoResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.dfd?.harness) {
      setError('Harness not available');
      setLoading(false);
      return;
    }

    window.dfd.harness.getInfo()
      .then((result) => {
        if (result.ok && result.result) {
          setInfo(result.result);
        } else {
          setError(result.error || 'Unknown error');
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { info, loading, error };
}

/**
 * Create and manage a Session Event Log
 */
export function useEventLog(sessionId?: string, runId?: string) {
  const [stats, setStats] = useState<EventLogStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createdRef = useRef(false);

  const create = useCallback(async (sid?: string, rid?: string) => {
    if (!window.dfd?.harness) {
      setError('Harness not available');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.dfd.harness.createEventLog({
        sessionId: sid || sessionId || `session-${Date.now()}`,
        runId: rid || runId,
      });

      if (result.ok && result.result) {
        setStats(result.result);
      } else {
        setError(result.error || 'Failed to create event log');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId, runId]);

  useEffect(() => {
    if (!createdRef.current && sessionId) {
      createdRef.current = true;
      create();
    }
  }, [create, sessionId]);

  return { stats, loading, error, create };
}

/**
 * Create and manage a Runtime Manager
 */
export function useRuntimeManager(defaultType?: 'local' | 'remote' | 'enterprise') {
  const [stats, setStats] = useState<RuntimeStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (type?: string) => {
    if (!window.dfd?.harness) {
      setError('Harness not available');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.dfd.harness.createRuntimeManager({
        defaultType: (type || defaultType || 'local') as 'local' | 'remote' | 'enterprise',
      });

      if (result.ok && result.result) {
        setStats(result.result);
      } else {
        setError(result.error || 'Failed to create runtime manager');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [defaultType]);

  return { stats, loading, error, create };
}

/**
 * Create and manage a Hook Bus
 */
export function useHookBus() {
  const [stats, setStats] = useState<HookBusStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async () => {
    if (!window.dfd?.harness) {
      setError('Harness not available');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.dfd.harness.createHookBus();

      if (result.ok && result.result) {
        setStats(result.result);
      } else {
        setError(result.error || 'Failed to create hook bus');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return { stats, loading, error, create };
}

/**
 * Create and manage a Plugin Manager
 */
export function usePluginManager() {
  const [stats, setStats] = useState<PluginStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async () => {
    if (!window.dfd?.harness) {
      setError('Harness not available');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.dfd.harness.createPluginManager();

      if (result.ok && result.result) {
        setStats(result.result);
      } else {
        setError(result.error || 'Failed to create plugin manager');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return { stats, loading, error, create };
}

/**
 * Combined Harness Core dashboard
 */
export function useHarnessDashboard() {
  const available = useHarnessAvailable();
  const harnessInfo = useHarnessInfo();
  const eventLog = useEventLog(`dashboard-${Date.now()}`);
  const runtimeManager = useRuntimeManager();
  const hookBus = useHookBus();
  const pluginManager = usePluginManager();

  const initialize = useCallback(async () => {
    await Promise.all([
      eventLog.create(),
      runtimeManager.create(),
      hookBus.create(),
      pluginManager.create(),
    ]);
  }, [eventLog, runtimeManager, hookBus, pluginManager]);

  useEffect(() => {
    if (available) {
      initialize();
    }
  }, [available, initialize]);

  return {
    available,
    info: harnessInfo.info,
    loading: harnessInfo.loading || eventLog.loading,
    error: harnessInfo.error,
    eventLog: eventLog.stats,
    runtimeManager: runtimeManager.stats,
    hookBus: hookBus.stats,
    pluginManager: pluginManager.stats,
    reinitialize: initialize,
  };
}
