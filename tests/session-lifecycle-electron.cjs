'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { app, session, BrowserWindow, ipcMain } = require('electron');
const { createSessionLifecycle } = require('../src/main/session-lifecycle');
app.enableSandbox();
app.setPath('userData', path.resolve(__dirname, '../.local/session-lifecycle-data'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.on('window-all-closed', () => {});
const timer = setTimeout(() => { console.error('SESSION_LIFECYCLE_TEST timeout'); app.exit(1); }, 30000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await pause(20); }
  throw new Error('Événement attendu absent');
}
app.whenReady().then(async () => {
  const localSession = session.fromPartition('session-lifecycle-local', { cache: false });
  localSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') }));
  ipcMain.handle('myneige:vault-status', () => ({ available: false, saved: false, hello: false }));
  ipcMain.handle('myneige:profile-status', () => ({ available: false, present: false, ready: false }));
  const form = new BrowserWindow({ show: false, width: 1120, height: 900, webPreferences: { session: localSession,
    preload: path.resolve(__dirname, '../src/preload/form.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await form.loadFile(path.resolve(__dirname, '../src/renderer/index.html'));
  const main = new BrowserWindow({ show: false }), popup = new BrowserWindow({ show: false, parent: main });
  let ready = true, expired = false;
  const sent = [];
  const lifecycle = createSessionLifecycle({ BrowserWindow, ipcMain, localSession, parent: () => popup, show: false,
    ready: () => ready, send: line => sent.push(line), stop: () => sent.push('STOP'),
    extended: () => form.webContents.send('myneige:state', 'SESSION_EXTENDED'),
    expired: async () => {
      ready = false; expired = true;
      for (const window of BrowserWindow.getAllWindows()) if (window !== form) window.destroy();
      form.webContents.send('myneige:state', 'SESSION_EXPIRED');
    } });
  const notice = () => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MyNEIGE · Fin de session');
  await lifecycle.warning(300);
  const first = notice(); assert(first); assert.equal(first.getParentWindow(), popup);
  assert.equal(await first.webContents.executeJavaScript('typeof require'), 'undefined');
  assert.equal(await first.webContents.executeJavaScript('typeof window.myneige'), 'undefined');
  assert.match(await first.webContents.executeJavaScript('document.getElementById("remaining").textContent'), /Fin de session dans/);
  assert(await first.webContents.executeJavaScript('document.documentElement.scrollHeight <= innerHeight'), 'Avertissement tronqué');
  fs.mkdirSync(path.resolve(__dirname, '../.local/session-lifecycle'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../.local/session-lifecycle/warning.png'), (await first.webContents.capturePage()).toPNG());
  await first.webContents.executeJavaScript('document.getElementById("extend").click()');
  await until(() => sent.length === 1); assert.deepEqual(sent, ['UI_SESSION_EXTEND']);
  assert(await first.webContents.executeJavaScript('document.getElementById("extend").disabled'));
  lifecycle.extended(); assert(first.isDestroyed()); assert(!main.isDestroyed()); assert(!popup.isDestroyed());
  await lifecycle.warning(1);
  const second = notice(); assert(second);
  await lifecycle.expire();
  assert(expired); assert(main.isDestroyed()); assert(popup.isDestroyed()); assert(second.isDestroyed());
  assert.deepEqual(BrowserWindow.getAllWindows(), [form]);
  assert(await form.webContents.executeJavaScript('document.querySelector("main").hidden && !document.getElementById("session-ended").hidden'));
  assert(await form.webContents.executeJavaScript('fetch("https://example.invalid/").then(() => false, () => true)'));
  // Un renderer masqué peut conserver la dernière image du compositeur.
  form.showInactive(); await pause(200);
  fs.writeFileSync(path.resolve(__dirname, '../.local/session-lifecycle/expired.png'), (await form.webContents.capturePage()).toPNG());
  lifecycle.dispose(); form.destroy();
  console.log('SESSION_LIFECYCLE_TEST passed warning=true trusted_ipc=true extension=true expiry=true local_screen=true');
}).then(() => { clearTimeout(timer); app.exit(0); }).catch(error => {
  clearTimeout(timer); console.error('SESSION_LIFECYCLE_TEST failed: ' + error.stack); app.exit(1);
});
