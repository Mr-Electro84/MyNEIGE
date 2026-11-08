'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, session, BrowserWindow, ipcMain, dialog } = require('electron');
const { createSshWindow } = require('../src/main/ssh-window');
app.enableSandbox();
app.disableHardwareAcceleration();
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
  let clipboardText = 'collage fictif', copied = '', confirmPaste = 0, pasteDialogs = 0, saveDialogs = 0, menu;
  const exportFile = path.resolve(__dirname, '../.local/ssh-preview/export.txt');
  const testDialog = {
    showMessageBox: async () => { ++pasteDialogs; return { response: confirmPaste }; },
    showSaveDialog: async () => { ++saveDialogs; return { canceled: false, filePath: exportFile }; }
  };
  fs.mkdirSync(path.dirname(exportFile), { recursive: true });
  const localSession = session.fromPartition('ssh-test-local', { cache: false });
  localSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') }));
  localSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  localSession.setPermissionCheckHandler(() => false);
  const parent = new BrowserWindow({ show: false });
  const vault = { status: async () => ({ saved, hello }), cancelActive: () => ++cancels, stop() { ++cancels; },
    unlock: async handle => { assert(handle > 0n); ++unlocks; return unlockResult; } };
  const manager = createSshWindow({ BrowserWindow, ipcMain, dialog: testDialog, localSession, vault,
    clipboard: { readText: async () => clipboardText, writeText: async text => { copied = text; } },
    Menu: { buildFromTemplate: entries => ({ popup() { menu = entries; } }) },
    fingerprint: () => 'A'.repeat(64), ready: () => active, proxy: () => ({ port: 12345, secret: 'a'.repeat(64) }),
    knownHostFile: path.join(app.getPath('userData'), 'known-host.json'), show: false,
    connectionFactory: options => {
      const connection = { stopped: false, inputs: [], sizes: [], emit: options.onData,
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

  // Outils réels du renderer ; presse-papiers et dialogues restent fictifs.
  await first.webContents.executeJavaScript('terminal.select(0, 0, 9); document.getElementById("copy").click()');
  await until(() => copied === 'Bienvenue');
  await first.webContents.executeJavaScript('document.getElementById("paste").click()');
  await until(() => connections[0].inputs.length === 2); assert.equal(connections[0].inputs.at(-1), 'collage fictif');
  clipboardText = 'ligne 1\nligne 2\n';
  await first.webContents.executeJavaScript('document.querySelector(".xterm-helper-textarea").dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true }))');
  await until(() => pasteDialogs === 1); await pause(40); assert.equal(connections[0].inputs.length, 2);
  confirmPaste = 1;
  await first.webContents.executeJavaScript('new Promise(resolve => terminal.write("\\x1b[?2004h", resolve))');
  await first.webContents.executeJavaScript('document.getElementById("paste").click()');
  await until(() => connections[0].inputs.length === 3);
  assert.equal(connections[0].inputs.at(-1), '\x1b[200~ligne 1\rligne 2\r\x1b[201~');
  clipboardText = 'x'.repeat(65537);
  await first.webContents.executeJavaScript('document.getElementById("paste").click()');
  await until(async () => (await first.webContents.executeJavaScript('document.getElementById("terminal-notice").textContent')).includes('60 Kio'));
  assert(!connections[0].stopped); assert.equal(connections[0].inputs.length, 3);
  await first.webContents.executeJavaScript('terminal.textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))');
  await pause(40); assert.equal(connections[0].inputs.length, 3);
  await first.webContents.executeJavaScript('new Promise(resolve => terminal.write("\\r\\nalpha alphabet ALPHA alpha\\r\\n", resolve))');
  await first.webContents.executeJavaScript('document.getElementById("find").click(); const input = document.getElementById("search-input"); input.value="alpha"; input.dispatchEvent(new Event("input"))');
  await until(async () => /\/ 4$/.test(await first.webContents.executeJavaScript('document.getElementById("search-results").textContent')));
  await first.webContents.executeJavaScript('document.getElementById("search-word").click()');
  await until(async () => /\/ 3$/.test(await first.webContents.executeJavaScript('document.getElementById("search-results").textContent')));
  await first.webContents.executeJavaScript('document.getElementById("search-case").click()');
  await until(async () => /\/ 2$/.test(await first.webContents.executeJavaScript('document.getElementById("search-results").textContent')));
  first.setSize(640, 500); first.showInactive(); await pause(160);
  assert(await first.webContents.executeJavaScript('document.documentElement.scrollHeight <= innerHeight && document.getElementById("terminal").clientHeight >= 60'), 'Outils tronqués à la taille minimale');
  fs.writeFileSync(path.resolve(__dirname, '../.local/ssh-preview/search.png'), (await first.webContents.capturePage()).toPNG());
  first.setSize(1060, 700);
  await first.webContents.executeJavaScript('document.getElementById("search-next").click(); document.getElementById("search-previous").click(); document.getElementById("search-close").click(); document.getElementById("zoom-in").click()');
  assert.equal(await first.webContents.executeJavaScript('terminal.options.fontSize'), 15);
  await first.webContents.executeJavaScript('document.getElementById("zoom-reset").click(); document.getElementById("export").click()');
  await until(async () => saveDialogs === 1 && (await first.webContents.executeJavaScript('document.getElementById("terminal-notice").textContent')).includes('enregistré'));
  assert.match(fs.readFileSync(exportFile, 'utf8'), /Bienvenue sur le serveur fictif é/);
  assert.match(fs.readFileSync(exportFile, 'utf8'), /alpha alphabet ALPHA alpha/);
  assert(!fs.readFileSync(exportFile, 'utf8').includes('\x1b'));
  connections[0].emit(Buffer.from(Array.from({ length: 120 }, (_, i) => 'ligne ' + i + '\r\n').join('')));
  await until(async () => await first.webContents.executeJavaScript('terminal.buffer.active.baseY > 50'));
  await first.webContents.executeJavaScript('terminal.scrollToTop()');
  connections[0].emit(Buffer.from('nouvelle sortie\r\n'));
  await until(async () => !(await first.webContents.executeJavaScript('document.getElementById("bottom").hidden')));
  await first.webContents.executeJavaScript('document.getElementById("bottom").click(); document.getElementById("more").click()');
  await until(() => menu); assert(menu.find(item => item.label === 'Copier'));
  menu.find(item => item.label === 'Effacer l’historique').click();
  await until(async () => await first.webContents.executeJavaScript('terminal.buffer.active.baseY === 0'));
  assert.equal(connections[0].inputs.length, 3);
  menu.find(item => item.label === 'Effacer l’écran').click();
  await until(async () => !(await first.webContents.executeJavaScript('TerminalBuffer.snapshot(terminal.buffer.active).includes("nouvelle sortie")')));
  assert(!connections[0].stopped); assert.equal(connections[0].inputs.length, 3);
  await first.webContents.executeJavaScript('terminal.textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "r", code: "KeyR", ctrlKey: true, bubbles: true, cancelable: true }))');
  await until(() => connections[0].inputs.length === 4); assert.equal(connections[0].inputs.at(-1), '\x12');
  const acceptedInputs = connections[0].inputs.length;

  // Une autre fenêtre munie du même preload n'est pas autorisée à piloter SSH.
  const foreign = new BrowserWindow({ show: false, webPreferences: { session: localSession, sandbox: true,
    contextIsolation: true, nodeIntegration: false, preload: path.resolve(__dirname, '../src/preload/ssh-terminal.js') } });
  await foreign.loadURL('about:blank');
  await foreign.webContents.executeJavaScript('window.pedagoTerminal.input("INJECTION"); window.pedagoTerminal.manual()');
  assert.deepEqual(await foreign.webContents.executeJavaScript('window.pedagoTerminal.tools("copy", "INJECTION")'), { ok: false, reason: 'unavailable' });
  await pause(80); assert.equal(connections[0].inputs.length, acceptedInputs); assert(!prompt()); foreign.destroy();

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
  console.log('SSH_ELECTRON_TEST passed popup=true xterm=true clipboard=true search=true export=true zoom=true scroll=true hello_flow=true cancellation=true trusted_ipc=true vpn_stop=true real_vpn=false');
}).then(() => { clearTimeout(timer); app.exit(0); }).catch(error => {
  clearTimeout(timer); console.error('SSH_ELECTRON_TEST failed: ' + error.stack); app.exit(1);
});
