'use strict';
const { app, session, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { CasPrefill, registerCasIPC } = require('../src/main/cas-prefill');
const { createProtectedWindow } = require('../src/main/protected-window');
const { run } = require('../src/main/cas-prefill-test');
app.enableSandbox();
app.setPath('userData', path.resolve(__dirname, '../.local/cas-electron-test'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.on('window-all-closed', () => {});
const owners = new WeakMap();
registerCasIPC(ipcMain, owners);
const timer = setTimeout(() => { console.error('CAS_ELECTRON_TEST timeout'); app.exit(1); }, 30000);
app.whenReady().then(() => run({ session, CasPrefill,
  protectedWindow: (session, prefiller) => createProtectedWindow({ BrowserWindow, session, prefiller, owners, show: false })
})).then(() => {
  clearTimeout(timer); console.log('CAS_ELECTRON_TEST passed cases=9 automatic_submissions=0'); app.exit(0);
}).catch(error => {
  clearTimeout(timer); console.error('CAS_ELECTRON_TEST failed: ' + error.message); app.exit(1);
});
