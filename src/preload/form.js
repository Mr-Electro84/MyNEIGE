'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('myneige', Object.freeze({
  profileStatus: () => ipcRenderer.invoke('myneige:profile-status'),
  importProfile: () => ipcRenderer.invoke('myneige:profile-import'),
  deleteProfile: () => ipcRenderer.invoke('myneige:profile-delete'),
  onProfileState: callback => {
    if (typeof callback === 'function') ipcRenderer.on('myneige:profile-state', (_event, value) => callback(value));
  },
  connect: (username, password, remember = false) => ipcRenderer.invoke('myneige:connect', { username, password }, remember),
  vaultStatus: () => ipcRenderer.invoke('myneige:vault-status'),
  unlock: () => ipcRenderer.invoke('myneige:vault-unlock'),
  forget: () => ipcRenderer.invoke('myneige:vault-forget'),
  onVaultState: callback => {
    if (typeof callback === 'function') ipcRenderer.on('myneige:vault-state', (_event, value) => callback(value));
  },
  disconnect: () => ipcRenderer.send('myneige:disconnect'),
  onState: callback => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('myneige:state', (_event, state) => callback(state));
  }
}));
