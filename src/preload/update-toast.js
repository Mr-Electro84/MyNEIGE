'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('myneigeUpdate', Object.freeze({
  action: choice => ipcRenderer.invoke('myneige:update-action', choice),
  onOffer: callback => {
    if (typeof callback === 'function') ipcRenderer.on('myneige:update-offer', (_event, version) => callback(version));
  }
}));
