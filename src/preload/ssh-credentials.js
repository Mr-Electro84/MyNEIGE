'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pedagoCredentials', {
  submit: value => ipcRenderer.invoke('myneige:ssh-credentials', value),
  cancel: () => ipcRenderer.invoke('myneige:ssh-credentials', null)
});
