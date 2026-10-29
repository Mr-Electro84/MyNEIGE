'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { createVpnProfile, registerProfileIPC } = require('../src/main/vpn-profile');
const { pathToFileURL } = require('node:url');
app.enableSandbox();
app.disableHardwareAcceleration();
app.setPath('userData', path.resolve(__dirname, '../.local/vpn-profile-electron'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.on('window-all-closed', () => {});
const timer = setTimeout(() => { console.error('VPN_PROFILE_TEST timeout'); app.exit(1); }, 30000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 200; ++i) { if (await check()) return; await pause(20); } throw new Error('Etat attendu absent'); }
app.whenReady().then(async () => {
  const local = session.fromPartition('vpn-profile-test', { cache: false });
  local.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') }));
  let form, selected, saved, connectCount = 0, invalidations = 0;
  const formPath = path.resolve(__dirname, '../src/renderer/index.html'), formURL = pathToFileURL(formPath).href;
  const trusted = event => form && event.sender === form.webContents && event.senderFrame === form.webContents.mainFrame && event.senderFrame.url === formURL;
  const helper = { readProfile: async () => saved && Buffer.from(saved), saveProfile: async source => { saved = Buffer.from(source); }, forgetProfile: async () => { saved = undefined; } };
  const profile = createVpnProfile({ helper, invalidate: () => ++invalidations,
    notify: value => { form.webContents.send('myneige:profile-state', value); form.webContents.send('myneige:state', value.ready ? 'AUTH_REQUIRED' : 'PROFILE_REQUIRED'); },
    send: frame => {
      const [verb, id, hex] = frame.split(' ');
      if (verb === 'UI_PROFILE_START') return;
      setImmediate(() => profile.reply(verb === 'UI_PROFILE_CLEAR' ? ['PROFILE_CLEARED', id] :
        Buffer.from(hex, 'hex').includes(Buffer.from('remote vpn.example.test')) ? ['PROFILE_ACCEPTED', id, 'A'.repeat(64)] : ['PROFILE_REJECTED', id]));
    } });
  registerProfileIPC(ipcMain, { trusted, profile, selectFile: async () => selected });
  ipcMain.handle('myneige:vault-status', () => ({ saved: false, hello: false, available: false }));
  ipcMain.handle('myneige:connect', event => { if (!trusted(event)) throw new Error('refus'); profile.start(); ++connectCount; return true; });
  const options = { session: local, preload: path.resolve(__dirname, '../src/preload/form.js'), sandbox: true, contextIsolation: true, nodeIntegration: false };
  form = new BrowserWindow({ show: true, width: 1120, height: 1000, webPreferences: options });
  await form.loadFile(formPath); await profile.load();
  const evaluate = code => form.webContents.executeJavaScript(code);
  await until(async () => await evaluate('document.getElementById("connect").disabled'));
  assert.equal(await evaluate('typeof require'), 'undefined');
  assert.equal(await evaluate('document.getElementById("profile-import").disabled'), false);
  await evaluate('window.myneige.importProfile()'); assert.equal(profile.status().present, false);
  selected = path.resolve(__dirname, 'fixtures/synthetic.ovpn');
  await evaluate('window.myneige.importProfile()');
  await until(async () => !(await evaluate('document.getElementById("connect").disabled')));
  assert(saved); assert.equal(connectCount, 0);
  assert.equal(await evaluate('document.getElementById("profile-import").textContent'), 'Remplacer le profil');
  const before = Buffer.from(saved);
  selected = path.resolve(__dirname, '../package.json');
  await evaluate('window.myneige.importProfile()'); assert.deepEqual(saved, before);
  assert.equal(profile.status().ready, true);
  const foreign = new BrowserWindow({ show: false, webPreferences: options });
  await foreign.loadFile(path.resolve(__dirname, '../src/renderer/session-warning.html'));
  for (const action of ['profileStatus', 'importProfile', 'deleteProfile'])
    assert.equal(await foreign.webContents.executeJavaScript(`window.myneige.${action}().then(() => false, () => true)`), true);
  foreign.destroy();
  await evaluate('window.myneige.deleteProfile()');
  assert.equal(saved, undefined); assert.equal(profile.status().ready, false);
  selected = path.resolve(__dirname, 'fixtures/synthetic.ovpn'); await evaluate('window.myneige.importProfile()');
  await until(async () => (await evaluate('document.getElementById("profile-state").textContent')).includes('Profil personnel prêt'));
  // La persistance est simulée ici ; DPAPI réel est vérifié par vault-self-test.
  const restarted = createVpnProfile({ helper, send: frame => {
    const [, id] = frame.split(' '); setImmediate(() => restarted.reply(['PROFILE_ACCEPTED', id, 'A'.repeat(64)]));
  }, invalidate: () => {}, notify: () => {} });
  await restarted.load(); assert.equal(restarted.status().ready, true); restarted.stop();
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'form.png'), (await form.webContents.capturePage()).toPNG()); }
  catch { console.log('VPN_PROFILE_TEST screenshot_unavailable'); }
  await evaluate('window.myneige.connect("fictif", "fictif", false)');
  assert.equal(connectCount, 1); assert.equal(profile.status().locked, true);
  assert.equal(await evaluate('window.myneige.deleteProfile().then(() => false, () => true)'), true);
  assert(invalidations >= 5); profile.stop(); clearTimeout(timer);
  console.log('VPN_PROFILE_TEST passed import=true invalid_preserved=true deletion=true reload=true foreign_ipc_refused=true locked=true no_real_profile=true');
  form.destroy(); app.exit(0);
}).catch(error => { clearTimeout(timer); console.error(`VPN_PROFILE_TEST failed: ${error.stack}`); app.exit(1); });
