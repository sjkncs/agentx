/**
 * AgentX Desktop — Preload
 *
 * Exposes a typed `window.dfd` API to the renderer for IPC calls.
 * No Node access leaks into the renderer.
 */
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  openLogs: () => ipcRenderer.invoke('app:openLogs'),
  openRepo: () => ipcRenderer.invoke('app:openRepo'),
  restart: () => ipcRenderer.invoke('app:restart'),
  cdl: {
    run: ({ regime, phiSem, phiCf, uSem, uCf }) =>
      ipcRenderer.invoke('cdl:run', { regime, phiSem, phiCf, uSem, uCf }),
  },
  harness: {
    getInfo: () => ipcRenderer.invoke('harness:getInfo'),
    createEventLog: ({ sessionId, runId }) =>
      ipcRenderer.invoke('harness:createEventLog', { sessionId, runId }),
    createRuntimeManager: ({ defaultType }) =>
      ipcRenderer.invoke('harness:createRuntimeManager', { defaultType }),
    createHookBus: () => ipcRenderer.invoke('harness:createHookBus'),
    createPluginManager: () => ipcRenderer.invoke('harness:createPluginManager'),
  },
  pet: {
    list: () => ipcRenderer.invoke('pet:list'),
    get: (id) => ipcRenderer.invoke('pet:get', id),
    save: (input) => ipcRenderer.invoke('pet:save', input),
    update: (id, patch) => ipcRenderer.invoke('pet:update', id, patch),
    deletePet: (id) => ipcRenderer.invoke('pet:delete', id),
    ackDisclaimer: (petId) => ipcRenderer.invoke('pet:ackDisclaimer', petId),
    describeImages: ({ reference_images }) =>
      ipcRenderer.invoke('pet:describeImages', { reference_images }),
    startChat: ({ petId, mode, message, sessionId }) =>
      ipcRenderer.invoke('pet:startChat', { petId, mode, message, sessionId }),
    onEvent: async (handle, cb) => {
      const unsubscribe = await ipcRenderer.invoke('pet:onEvent', { runId: handle.runId });
      const handler = (_e, payload) => {
        if (payload.runId !== handle.runId) return;
        cb(payload.event);
      };
      ipcRenderer.on('pet:event', handler);
      return () => {
        ipcRenderer.off('pet:event', handler);
        if (typeof unsubscribe === 'function') unsubscribe();
      };
    },
    voiceAdapter: () => ipcRenderer.invoke('pet:voiceAdapter'),
    getCurrentPet: () => ipcRenderer.invoke('pet:getCurrentPet'),
    resolveAfterSave: (payload) => ipcRenderer.invoke('pet:resolveAfterSave', payload),
    onPetSaved: (cb) => {
      const handler = (_e, payload) => cb(payload);
      ipcRenderer.on('pet:callback:saved', handler);
      return () => ipcRenderer.off('pet:callback:saved', handler);
    },
    onPetCancelled: (cb) => {
      const handler = (_e, payload) => cb(payload);
      ipcRenderer.on('pet:callback:cancelled', handler);
      return () => ipcRenderer.off('pet:callback:cancelled', handler);
    },
  },
};

contextBridge.exposeInMainWorld('dfd', api);