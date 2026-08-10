/**
 * DataFoundry Desktop — Preload
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
};

contextBridge.exposeInMainWorld('dfd', api);