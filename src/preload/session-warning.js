'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('myneigeSession', Object.freeze({
  extend: () => ipcRenderer.send('myneige:session-action', 'extend'),
  stop: () => ipcRenderer.send('myneige:session-action', 'stop'),
  onWarning: callback => {
    if (typeof callback === 'function') ipcRenderer.on('myneige:session-warning', (_event, seconds) => callback(seconds));
  },
  onPending: callback => {
    if (typeof callback === 'function') ipcRenderer.on('myneige:session-pending', () => callback());
  }
}));
