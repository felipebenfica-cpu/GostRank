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
  social: (action, value) => ipcRenderer.invoke('gr:social', { action, value }),
  createGroup: (name) => ipcRenderer.invoke('gr:group:create', { name }),
  joinGroup: (code) => ipcRenderer.invoke('gr:group:join', { code }),
  leaveGroup: () => ipcRenderer.invoke('gr:group:leave', { confirm: true }),
  createInvite: () => ipcRenderer.invoke('gr:group:invite', {}),
  removeMember: (userId) => ipcRenderer.invoke('gr:group:remove', { userId }),
  refreshGroup: () => ipcRenderer.invoke('gr:group:refresh', {}),
  sendMessage: (body) => ipcRenderer.invoke('gr:chat:send', { body }),
  editMessage: (id, body) => ipcRenderer.invoke('gr:chat:edit', { id, body }),
  deleteMessage: (id) => ipcRenderer.invoke('gr:chat:delete', { id }),
  voiceToken: () => ipcRenderer.invoke('gr:voice:token', {}),
  listScreenSources: () => ipcRenderer.invoke('gr:voice:listSources', {}),
  pickScreenSource: (sourceId) => ipcRenderer.invoke('gr:voice:pickSource', { sourceId }),
  linkSteam: () => ipcRenderer.invoke('gr:steam:link', {}),
  onUpdate: (cb) => {
    if (typeof cb !== 'function') return () => {};
    const listener = (_event, view) => cb(view);
    ipcRenderer.on('gr:update', listener);
    return () => ipcRenderer.removeListener('gr:update', listener);
  },
});
