'use strict';
const { app, session, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { CasPrefill, registerCasIPC } = require('../src/main/cas-prefill');
const { createProtectedWindow } = require('../src/main/protected-window');
const { run } = require('../src/main/browser-features-test');
app.enableSandbox();
app.setPath('userData', path.resolve(__dirname, '../.local/browser-features-data'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.on('window-all-closed', () => {});
const owners = new WeakMap(); registerCasIPC(ipcMain, owners);
const timer = setTimeout(() => { console.error('BROWSER_FEATURES_TEST timeout'); app.exit(1); }, 30000);
app.whenReady().then(() => run({ session, CasPrefill,
  directory: path.resolve(__dirname, '../.local/download-fixtures'),
  protectedWindow: (session, prefiller, downloads, ready) => createProtectedWindow({ BrowserWindow, session, prefiller, owners, downloads, ready, show: false })
})).then(checks => {
  clearTimeout(timer); console.log(`BROWSER_FEATURES_TEST passed checks=${checks}`); app.exit(0);
}).catch(error => {
  clearTimeout(timer); console.error('BROWSER_FEATURES_TEST failed: ' + error.message); app.exit(1);
});
