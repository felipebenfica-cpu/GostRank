'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostRank', {
  getView: () => ipcRenderer.invoke('gr:getView'),
  setup: (data) => ipcRenderer.invoke('gr:setup', data),
  sync: () => ipcRenderer.invoke('gr:sync'),
  correctMmr: (mmr) => ipcRenderer.invoke('gr:correctMmr', { mmr }),
  updateSettings: (data) => ipcRenderer.invoke('gr:updateSettings', data),
  reset: () => ipcRenderer.invoke('gr:reset', { confirm: true }),
  signUp: (data) => ipcRenderer.invoke('gr:auth:signUp', data),
  signIn: (data) => ipcRenderer.invoke('gr:auth:signIn', data),
  signOut: () => ipcRenderer.invoke('gr:auth:signOut'),
  recover: (data) => ipcRenderer.invoke('gr:auth:recover', data),
  updateProfile: (data) => ipcRenderer.invoke('gr:profile:update', data),
  deleteAccount: () => ipcRenderer.invoke('gr:account:delete', { confirm: true }),
  onUpdate: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const listener = (_event, view) => cb(view);
    ipcRenderer.on('gr:update', listener);
    return () => ipcRenderer.removeListener('gr:update', listener);
  },
});
