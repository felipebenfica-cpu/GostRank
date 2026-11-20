'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostRank', {
  getView: () => ipcRenderer.invoke('gr:getView'),
  setup: (data) => ipcRenderer.invoke('gr:setup', data),
  sync: () => ipcRenderer.invoke('gr:sync'),
  correctMmr: (mmr) => ipcRenderer.invoke('gr:correctMmr', { mmr }),
  updateSettings: (data) => ipcRenderer.invoke('gr:updateSettings', data),
  reset: () => ipcRenderer.invoke('gr:reset', { confirm: true }),
  onUpdate: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const listener = (_event, view) => cb(view);
    ipcRenderer.on('gr:update', listener);
    return () => ipcRenderer.removeListener('gr:update', listener);
  },
});
