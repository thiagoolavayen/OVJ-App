'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose individual capabilities, never ipcRenderer, filesystem access, or a URL loader.
contextBridge.exposeInMainWorld('ovj', Object.freeze({
  getState: () => ipcRenderer.invoke('ovj:state'),
  saveSettings: (patch) => ipcRenderer.invoke('ovj:save', patch),
  chooseBall: () => ipcRenderer.invoke('ovj:choose-ball'),
  removeBall: () => ipcRenderer.invoke('ovj:remove-ball'),
  setFullscreen: () => ipcRenderer.invoke('ovj:fullscreen'),
  reloadGame: () => ipcRenderer.invoke('ovj:reload'),
  restart: () => ipcRenderer.invoke('ovj:restart'),
  startBenchmark: () => ipcRenderer.invoke('ovj:benchmark-start'),
  stopBenchmark: () => ipcRenderer.invoke('ovj:benchmark-stop'),
  exportDiagnostics: () => ipcRenderer.invoke('ovj:export-diagnostics'),
  close: () => ipcRenderer.send('ovj:close-settings'),
  onState: (listener) => {
    if (typeof listener !== 'function') throw new TypeError('Se esperaba una función.');
    const receive = (_event, state) => listener(state);
    ipcRenderer.on('ovj:state-changed', receive);
    return () => ipcRenderer.removeListener('ovj:state-changed', receive);
  },
  onNavigateSection: (listener) => {
    if (typeof listener !== 'function') throw new TypeError('Se esperaba una función.');
    const receive = (_event, section) => {
      if (['performance', 'ball', 'discord', 'diagnostics'].includes(section)) listener(section);
    };
    ipcRenderer.on('ovj:navigate-section', receive);
    return () => ipcRenderer.removeListener('ovj:navigate-section', receive);
  },
}));
