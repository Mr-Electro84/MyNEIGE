'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pedagoTerminal', {
  input: value => ipcRenderer.send('myneige:ssh-action', 'input', value),
  resize: value => ipcRenderer.send('myneige:ssh-action', 'resize', value),
  acknowledge: (epoch, bytes) => ipcRenderer.send('myneige:ssh-action', 'ack', { epoch, bytes }),
  connect: () => ipcRenderer.send('myneige:ssh-action', 'connect'),
  manual: () => ipcRenderer.send('myneige:ssh-action', 'manual'),
  disconnect: () => ipcRenderer.send('myneige:ssh-action', 'disconnect'),
  tools: (action, value) => ipcRenderer.invoke('myneige:ssh-tools', action, value),
  onCommand: callback => ipcRenderer.on('myneige:ssh-command', (_event, value) => callback(value)),
  onNotice: callback => ipcRenderer.on('myneige:ssh-notice', (_event, value) => callback(value)),
  onData: callback => ipcRenderer.on('myneige:ssh-data', (_event, bytes) => callback(bytes)),
  onState: callback => ipcRenderer.on('myneige:ssh-state', (_event, value, epoch) => callback(value, epoch))
});
