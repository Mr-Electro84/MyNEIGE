'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, session, BrowserWindow, ipcMain, dialog } = require('electron');
const { createSshWindow } = require('../src/main/ssh-window');
app.enableSandbox();
app.setPath('userData', path.resolve(__dirname, '../.local/ssh-electron-data'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.on('window-all-closed', () => {});
const timer = setTimeout(() => { console.error('SSH_ELECTRON_TEST timeout'); app.exit(1); }, 40000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition) {
  for (let i = 0; i < 200; i++) { if (await condition()) return; await pause(20); }
  throw new Error('Événement terminal attendu absent');
}
app.whenReady().then(async () => {
  let active = true, hello = false, saved = false, unlockResult, unlocks = 0, cancels = 0;
  const connections = [], submitted = [];
  const localSession = session.fromPartition('ssh-test-local', { cache: false });
  localSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') }));
  localSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  localSession.setPermissionCheckHandler(() => false);
  const parent = new BrowserWindow({ show: false });
  const vault = { status: async () => ({ saved, hello }), cancelActive: () => ++cancels, stop() { ++cancels; },
    unlock: async handle => { assert(handle > 0n); ++unlocks; return unlockResult; } };
  const manager = createSshWindow({ BrowserWindow, ipcMain, dialog, localSession, vault,
    fingerprint: () => 'A'.repeat(64), ready: () => active, proxy: () => ({ port: 12345, secret: 'a'.repeat(64) }),
    knownHostFile: path.join(app.getPath('userData'), 'known-host.json'), show: false,
    connectionFactory: options => {
      const connection = { stopped: false, inputs: [], sizes: [],
        async start(credentials) {
          submitted.push({ ...credentials }); credentials.username = credentials.password = '';
          options.onState('connecting'); options.onState('connected');
          options.onData(Buffer.from('Bienvenue sur le serveur fictif é\r\n$ '));
        },
        input(value) { this.inputs.push(value); }, resize(value) { this.sizes.push(value); },
        acknowledge(bytes) { this.ack = (this.ack || 0) + bytes; }, stop() { this.stopped = true; } };
      connections.push(connection); return connection;
    } });
  const terminal = () => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MyNEIGE · Serveur pédagogique');
  const prompt = () => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MyNEIGE · Connexion au serveur pédagogique');
  await manager.open(parent); await until(prompt);
  const first = terminal(), credentials = prompt();
  assert(first && credentials); assert.equal(first.getParentWindow(), parent); assert.equal(credentials.getParentWindow(), first);
  assert(credentials.isModal());
  assert.equal(await first.webContents.executeJavaScript('typeof require'), 'undefined');
  assert.equal(await first.webContents.executeJavaScript('typeof process'), 'undefined');
  assert.equal(await first.webContents.executeJavaScript('typeof window.pedagoCredentials'), 'undefined');
  assert.equal(await credentials.webContents.executeJavaScript('typeof window.pedagoTerminal'), 'undefined');
  assert(await first.webContents.executeJavaScript('fetch("https://example.invalid/").then(() => false, () => true)'));
  assert(await credentials.webContents.executeJavaScript('document.documentElement.scrollHeight <= innerHeight'));
  await credentials.webContents.executeJavaScript(`document.getElementById('username').value = 'compte-fictif';
    document.getElementById('password').value = 'secret-fictif'; document.getElementById('submit').click();`);
  await until(() => submitted.length === 1 && connections[0].ack > 0);
  assert(credentials.isDestroyed()); assert.deepEqual(submitted[0], { username: 'compte-fictif', password: 'secret-fictif' });
  assert(await first.webContents.executeJavaScript('terminal.buffer.active.getLine(0).translateToString().includes("serveur fictif é")'));
  assert(await first.webContents.executeJavaScript('document.getElementById("connect").disabled && !document.getElementById("disconnect").disabled'));
  await first.webContents.executeJavaScript('window.pedagoTerminal.input("ls\\r\\u0003"); window.pedagoTerminal.resize({ cols: 110, rows: 35 })');
  await until(() => connections[0].inputs.length === 1); assert.equal(connections[0].inputs[0], 'ls\r\x03');
  await manager.open(parent); assert.equal(terminal(), first); assert.equal(connections.length, 1);

  // Une autre fenêtre munie du même preload n'est pas autorisée à piloter SSH.
  const foreign = new BrowserWindow({ show: false, webPreferences: { session: localSession, sandbox: true,
    contextIsolation: true, nodeIntegration: false, preload: path.resolve(__dirname, '../src/preload/ssh-terminal.js') } });
  await foreign.loadURL('about:blank');
  await foreign.webContents.executeJavaScript('window.pedagoTerminal.input("INJECTION"); window.pedagoTerminal.manual()');
  await pause(80); assert.equal(connections[0].inputs.length, 1); assert(!prompt()); foreign.destroy();

  first.showInactive(); await pause(180);
  fs.mkdirSync(path.resolve(__dirname, '../.local/ssh-preview'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../.local/ssh-preview/terminal.png'), (await first.webContents.capturePage()).toPNG());
  await first.webContents.executeJavaScript('document.getElementById("disconnect").click()');
  await until(() => connections[0].stopped);
  await until(() => first.webContents.executeJavaScript('!document.getElementById("connect").disabled'));
  hello = saved = true; unlockResult = { username: 'hello-fictif', password: 'secret-fictif' };
  await first.webContents.executeJavaScript('document.getElementById("connect").click()');
  await until(() => submitted.length === 2); assert.equal(unlocks, 1); assert(!prompt());
  assert.deepEqual(submitted[1], { username: 'hello-fictif', password: 'secret-fictif' });
  await first.webContents.executeJavaScript('document.getElementById("disconnect").click()');
  await until(() => connections[1].stopped);
  await until(() => first.webContents.executeJavaScript('!document.getElementById("connect").disabled'));
  unlockResult = null;
  await first.webContents.executeJavaScript('document.getElementById("connect").click()');
  await until(async () => (await first.webContents.executeJavaScript('document.getElementById("status").textContent')).includes('annulée'));
  assert(!prompt()); assert.equal(connections.length, 2);
  await first.webContents.executeJavaScript('document.getElementById("manual").click()'); await until(prompt);
  assert.equal(unlocks, 2);
  const lastPrompt = prompt();
  lastPrompt.showInactive(); await pause(150);
  fs.writeFileSync(path.resolve(__dirname, '../.local/ssh-preview/credentials.png'), (await lastPrompt.webContents.capturePage()).toPNG());
  active = false; manager.dispose();
  assert(first.isDestroyed()); assert(lastPrompt.isDestroyed()); assert(cancels > 0);
  await manager.open(parent); assert(!terminal()); parent.destroy();
  console.log('SSH_ELECTRON_TEST passed popup=true xterm=true dialog=true hello_flow=true cancellation=true trusted_ipc=true vpn_stop=true real_vpn=false');
}).then(() => { clearTimeout(timer); app.exit(0); }).catch(error => {
  clearTimeout(timer); console.error('SSH_ELECTRON_TEST failed: ' + error.stack); app.exit(1);
});
