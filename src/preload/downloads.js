'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('myneigeDownloads', Object.freeze({
  action: (choice, id) => ipcRenderer.invoke('myneige:downloads-action', choice, id),
  onChanged: callback => {
    if (typeof callback === 'function') ipcRenderer.on('myneige:downloads-changed', (_event, records) => callback(records));
  }
}));
