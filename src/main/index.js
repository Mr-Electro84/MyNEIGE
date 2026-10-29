'use strict';
const { app, BrowserWindow, ipcMain, session, Menu, dialog, net: electronNet, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const dgram = require('node:dgram');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { START_URL, allowedURL, validateCredentials } = require('./policy');
const { CasPrefill, registerCasIPC } = require('./cas-prefill');
const { createProtectedWindow } = require('./protected-window');
const { createDownloads } = require('./downloads');
const { createDownloadsWindow } = require('./downloads-window');
const { protectRequests } = require('./session-policy');
const { NativeVault } = require('./native-vault');
const { createVpnProfile, registerProfileIPC } = require('./vpn-profile');
const { APP_ICON } = require('./app-icon');
const { helpMenu } = require('./about');
const { networkErrors, networkError, requestMetadata } = require('./network-diagnostics');
const { createSessionLifecycle } = require('./session-lifecycle');
const { createUpdateService, createUpdateTransport, UPDATE_CHECK_ENABLED } = require('./updates');
const { createUpdateToast } = require('./update-toast');
const metadata = require('../../package.json');

// Network restrictions already exist in WFP before this process starts.
app.enableSandbox();
app.setName('MyNEIGE');
if (process.platform === 'win32') app.setAppUserModelId('fr.myneige.desktop');
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-http-cache');
// Exclude the numeric proxy endpoint itself; Chromium applies mapping before
// handling IP literals too. WFP still permits only this session's proxy port.
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-features', 'DnsOverHttps,MediaRouter');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-crash-reporter');
Menu.setApplicationMenu(null);
let form, webSession, remote, proxyPort, proxySecret, authPending = false, stopping = false, testMode = false;
const formPath = path.join(__dirname, '../renderer/index.html');
const formURL = pathToFileURL(formPath).href;
let channel;
const send = value => (channel || process.stdout).write(`${value}\n`);
let vpnReady = false, downloads, downloadsWindow, sessionLifecycle, updates, updateToast, formSession;
let vault, profile, vaultBusy = false, vaultEpoch = 0, rememberPending, rememberTimer;
function clearRemember() {
  clearTimeout(rememberTimer); rememberTimer = undefined;
  rememberPending?.user.fill(0); rememberPending?.password.fill(0); rememberPending = undefined;
}
function vaultState(value) { if (form && !form.isDestroyed()) form.webContents.send('myneige:vault-state', value); }
async function vaultStatus(message) {
  if (!vault) return { saved: false, hello: false, available: false };
  try { const status = { ...await vault.status(), available: true, message }; vaultState(status); return status; }
  catch { const status = { saved: false, hello: false, available: false, message: 'UNAVAILABLE' }; vaultState(status); return status; }
}
const prefillOwners = new WeakMap();
const casPrefill = new CasPrefill({ ready: () => vpnReady && !stopping, report: status => {
  send(`UI_CAS_PREFILL ${status}`);
  if (status === 'PREFILLED') state('CAS_PREFILLED');
  else state('CAS_MANUAL');
} });
function diagnostic(error) {
  const kind = ['Error', 'TypeError', 'ReferenceError', 'RangeError'].includes(error?.name) ? error.name : 'OTHER';
  const location = String(error?.stack || '').match(/index\.js:(\d+):(\d+)/);
  const code = networkErrors.has(error?.code) || ['ENOENT', 'EACCES', 'EPERM', 'EBUSY'].includes(error?.code) ? error.code : 'OTHER';
  send(`BROWSER_DIAGNOSTIC kind=${kind} line=${location?.[1] || 0} code=${code}`);
  // This branch is reachable only in the credential-free local integration test.
  if (testMode) send(`BROWSER_DIAGNOSTIC reason=${String(error?.message || '').replace(/[\r\n]/g, ' ').slice(0, 110)}`);
}
send('BROWSER_STAGE ENTRY');
function state(value) { if (form && !form.isDestroyed()) form.webContents.send('myneige:state', value); }
function trusted(event) {
  return form && event.sender === form.webContents && event.senderFrame === form.webContents.mainFrame && event.senderFrame.url === formURL;
}
function tcp(host, port, denied) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('probe-timeout')); }, 3000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); denied ? reject(new Error('unexpected-network-access')) : resolve(); });
    socket.once('error', error => {
      clearTimeout(timer); socket.destroy();
      const code = /^[A-Z_]{1,30}$/.test(error.code || '') ? error.code : 'OTHER';
      if (!process.argv.includes('--myneige-network-child')) send(`BROWSER_PROBE TCP_RESULT ${code}`);
      denied && error.code === 'EACCES' ? resolve() : reject(new Error('unexpected-probe-error'));
    });
  });
}
function udp(port, ipv6 = false) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(ipv6 ? 'udp6' : 'udp4');
    const timer = setTimeout(() => { socket.close(); reject(new Error('udp-probe-timeout')); }, 3000);
    socket.send(Buffer.from('MyNEIGE probe'), port, ipv6 ? '::1' : '127.0.0.1', error => {
      clearTimeout(timer); socket.close();
      if (!process.argv.includes('--myneige-network-child')) send(`BROWSER_PROBE UDP_RESULT ${error && /^[A-Z_]{1,30}$/.test(error.code || '') ? error.code : 'NO_ERROR'}`);
      // Unconnected UDP may report successful submission even when WFP drops it.
      // The native supervisor separately proves that its positively tested receivers got no datagram.
      !error || error.code === 'EACCES' ? resolve() : reject(new Error('udp-probe-error'));
    });
  });
}
async function quarantineTests(v4, v6) {
  if (!process.argv.includes('--myneige-network-child')) send('BROWSER_STAGE TEST_TCP4');
  await tcp('127.0.0.1', v4, true);
  if (!process.argv.includes('--myneige-network-child')) send('BROWSER_STAGE TEST_TCP6');
  await tcp('::1', v6, true);
  if (!process.argv.includes('--myneige-network-child')) send('BROWSER_STAGE TEST_UDP');
  await udp(v4);
  await udp(v6, true);
}
async function testChild(v4, v6) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, '--myneige-network-child', String(v4), String(v6)], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    child.stdout.on('data', part => { output += part.toString(); if (output.length > 4096) child.kill(); });
    child.once('exit', code => code === 0 && output.includes('CHILD_BLOCKED') ? resolve() : reject(new Error('child-quarantine-failed')));
    child.once('error', () => reject(new Error('child-launch-failed')));
    setTimeout(() => { if (child.exitCode === null) { child.kill(); reject(new Error('child-timeout')); } }, 15000).unref();
  });
}
if (process.argv.includes('--myneige-network-child')) {
  const offset = process.argv.indexOf('--myneige-network-child');
  quarantineTests(Number(process.argv[offset + 1]), Number(process.argv[offset + 2]))
    .then(() => { send('CHILD_BLOCKED'); app.exit(0); })
    .catch(() => app.exit(1));
} else {
  const pipeArgument = process.argv.find(value => value.startsWith('--myneige-pipe='));
  if (!pipeArgument || !/^\\\\\.\\pipe\\MyNEIGE-[a-f0-9]{32}$/.test(pipeArgument.slice('--myneige-pipe='.length))) app.exit(1);
  channel = net.createConnection({ path: pipeArgument.slice('--myneige-pipe='.length) });
  channel.on('error', () => shutdown());
  const lines = readline.createInterface({ input: channel, crlfDelay: Infinity });
  let sequence = Promise.resolve();
  lines.on('line', line => { sequence = sequence.then(() => control(line)).catch(error => { diagnostic(error); send('UI_ERROR INITIALIZATION'); shutdown(true); }); });
  lines.on('close', () => { send('BROWSER_STAGE CONTROL_EOF'); state('BLOCKED'); shutdown(); });
}
async function control(line) {
  const parts = line.split(' ');
  if (parts[0] === 'BOOT' && parts.length === 4 && !form) {
    send('BROWSER_STAGE BOOT');
    const v4 = Number(parts[1]), v6 = Number(parts[2]);
    if (![v4, v6].every(port => Number.isInteger(port) && port > 0 && port <= 65535)) throw new Error('ports');
    testMode = parts[3] === 'test';
    vault = new NativeVault(path.resolve(__dirname, '../../../myneige-vault.exe'));
    profile = createVpnProfile({ helper: vault, send, unavailable: () => stopping,
      invalidate: () => { ++vaultEpoch; clearRemember(); casPrefill.clear(); vault.cancelActive(); },
      notify: value => {
        if (!form || form.isDestroyed()) return;
        form.webContents.send('myneige:profile-state', value);
        authPending = value.ready;
        if (!value.locked) state(value.ready ? 'AUTH_REQUIRED' : 'PROFILE_REQUIRED');
      } });
    registerProfileIPC(ipcMain, { trusted, profile, selectFile: async () => {
      const result = await dialog.showOpenDialog(form, { title: 'Importer votre profil VPN personnel',
        properties: ['openFile', 'dontAddToRecent'], filters: [{ name: 'Profil OpenVPN', extensions: ['ovpn'] }] });
      return result.canceled ? undefined : result.filePaths[0];
    } });
    await app.whenReady();
    send('BROWSER_STAGE APP_READY');
    await quarantineTests(v4, v6);
    send('BROWSER_STAGE NETWORK_BLOCKED');
    await testChild(v4, v6);
    send('BROWSER_STAGE CHILD_BLOCKED');
    const localSession = session.fromPartition(`form-${Date.now()}`, { cache: false });
    formSession = localSession;
    localSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') }));
    form = new BrowserWindow({ title: 'MyNEIGE · Version Alpha', icon: APP_ICON, width: 1120, height: 900, show: !testMode,
      webPreferences: { session: localSession, preload: path.join(__dirname, '../preload/form.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
    send('BROWSER_STAGE FORM_CREATED');
    form.setMenu(Menu.buildFromTemplate([helpMenu(form, undefined, { checkUpdates: manualUpdateCheck })]));
    form.setMenuBarVisibility(true);
    form.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    form.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    form.webContents.on('will-navigate', event => event.preventDefault());
    form.on('closed', () => { form = null; if (!stopping) { send('UI_STOP'); shutdown(); } });
    await form.loadFile(formPath);
    sessionLifecycle = createSessionLifecycle({ BrowserWindow, ipcMain, localSession, ready: () => vpnReady && !stopping,
      send, stop: () => { send('UI_STOP'); shutdown(); }, expired: expireSession,
      extended: () => state('SESSION_EXTENDED'), show: !testMode });
    await vaultStatus();
    send('BROWSER_STAGE FORM_FILE_LOADED');
    if (testMode) {
      // A hidden compositor may refuse screenshots; sandbox and network probes
      // below remain mandatory regardless of this optional visual artifact.
      try {
        fs.mkdirSync(app.getPath('userData'), { recursive: true });
        fs.writeFileSync(path.join(app.getPath('userData'), 'form-preview.png'), (await form.webContents.capturePage()).toPNG());
      } catch { send('BROWSER_STAGE SCREENSHOT_UNAVAILABLE'); }
    }
    send('BROWSER_STAGE FORM_LOADED');
    send('UI_NETWORK_BLOCKED');
  } else if (parts[0] === 'TEST_PROXY' && parts.length === 2 && form) {
    await tcp('127.0.0.1', Number(parts[1]), false);
    if (await form.webContents.executeJavaScript('typeof require !== "undefined" || typeof process !== "undefined" || typeof window.myneige?.connect !== "function"')) throw new Error('sandbox');
    send('UI_READY');
  } else if (parts[0] === 'TEST_NAV_PROXY' && parts.length === 3 && form && testMode) {
    proxyPort = Number(parts[1]); proxySecret = parts[2];
    if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535 || !/^[a-f0-9]{64}$/.test(proxySecret)) throw new Error('proxy');
    try {
      await openProtectedSession();
      throw new Error('unexpected-local-proxy-success');
    } catch (error) {
      if (!['ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_RESET', 'ERR_EMPTY_RESPONSE', 'ERR_SSL_PROTOCOL_ERROR', 'ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED'].includes(error.code)) throw error;
    }
    send('UI_NAV_PROXY_DONE');
  } else if (line === 'TEST_CAS_PREFILL' && form && testMode) {
    await require('./cas-prefill-test').run({ session, protectedWindow, CasPrefill });
    send('UI_CAS_TEST_DONE');
  } else if (line === 'TEST_VAULT' && form && testMode) {
    const result = await form.webContents.executeJavaScript('window.myneige.vaultStatus()');
    if (!result.available || typeof result.saved !== 'boolean' || typeof result.hello !== 'boolean' || 'password' in result || 'username' in result) throw new Error('Native vault status integration failed');
    send('UI_VAULT_TEST_DONE');
  } else if (line === 'TEST_BROWSER_FEATURES' && form && testMode) {
    // La fixture possède sa propre fenêtre et son IPC ; libérer ceux du test proxy précédent.
    downloadsWindow?.dispose(); downloads?.dispose(); downloadsWindow = undefined; downloads = undefined;
    await require('./browser-features-test').run({ session, CasPrefill, directory: path.join(app.getPath('userData'), 'download-fixtures'),
      protectedWindow: (browserSession, prefiller, fixtureDownloads, ready, openExternal) => createProtectedWindow({ BrowserWindow,
        session: browserSession, prefiller, owners: prefillOwners, downloads: fixtureDownloads, ready, openExternal, show: false }) });
    send('UI_BROWSER_FEATURES_DONE');
  } else if (line === 'TEST_SESSION_WARNING' && form && testMode) {
    for (const window of BrowserWindow.getAllWindows()) if (window !== form) window.destroy();
    webSession = session.fromPartition(`session-test-${Date.now()}`, { cache: false });
    webSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }));
    vpnReady = true;
    remote = protectedWindow(); protectedWindow();
    await sessionLifecycle.warning(300);
    const notice = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MyNEIGE · Fin de session');
    if (!notice) throw new Error('Session warning missing');
    await notice.webContents.executeJavaScript('document.getElementById("extend").click()');
  } else if (line === 'TEST_SESSION_EXTENDED' && form && testMode) {
    if (!vpnReady || remote.isDestroyed() || BrowserWindow.getAllWindows().length !== 3)
      throw new Error('Session renewal interrupted protected windows');
    send('UI_SESSION_RENEWAL_DONE');
  } else if (line === 'TEST_SESSION_EXPIRED' && form && testMode) {
    if (vpnReady || BrowserWindow.getAllWindows().length !== 1 ||
        !await form.webContents.executeJavaScript('document.querySelector("main").hidden && !document.getElementById("session-ended").hidden'))
      throw new Error('Session expiry did not retain only the local screen');
    send('UI_SESSION_EXPIRY_DONE');
  } else if (parts[0] === 'SESSION_WARNING' && parts.length === 2 && /^[0-9]{1,3}$/.test(parts[1]) && sessionLifecycle) {
    // Le chargement de l'avertissement ne retarde jamais une trame d'arrêt.
    void sessionLifecycle.warning(Number(parts[1])).catch(error => { diagnostic(error); shutdown(true); });
  } else if (line === 'SESSION_EXTENDED' && sessionLifecycle) {
    sessionLifecycle.extended();
  } else if (line === 'SESSION_EXPIRED' && sessionLifecycle) {
    await sessionLifecycle.expire();
  } else if (line === 'PROFILE_REQUIRED' && form) {
    void profile.load().catch(() => { state('PROFILE_REQUIRED'); });
  } else if (['PROFILE_ACCEPTED', 'PROFILE_REJECTED', 'PROFILE_CLEARED'].includes(parts[0])) {
    profile.reply(parts);
  } else if (parts[0] === 'PROFILE_LOCKED' && parts.length === 2) {
    if (!profile.status().locked) throw new Error('profile-lock');
  } else if (line === 'AUTH_REQUIRED' && form) {
    if (profile?.status().locked) state('CONNECTING');
    else { authPending = true; state('AUTH_REQUIRED'); }
    void vaultStatus();
  } else if (parts[0] === 'STATE' && parts.length === 2 && ['BLOCKED', 'ERROR', 'CONNECTING'].includes(parts[1])) {
    if (parts[1] !== 'CONNECTING') { vpnReady = false; stopUpdates(); casPrefill.clear(); clearRemember(); downloads?.stop(); }
    state(parts[1]);
    if (parts[1] === 'BLOCKED' && remote && !remote.isDestroyed()) remote.destroy();
  } else if (parts[0] === 'VPN_READY' && parts.length === 3 && form && !proxySecret) {
    proxyPort = Number(parts[1]); proxySecret = parts[2];
    if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535 || !/^[a-f0-9]{64}$/.test(proxySecret)) throw new Error('proxy');
    vpnReady = true;
    if (!testMode) {
      try { startUpdates(); }
      catch { stopUpdates(); } // Le contrôle facultatif ne doit pas arrêter la connexion.
    }
    if (rememberPending) {
      const credentials = { username: rememberPending.user.toString('utf8'), password: rememberPending.password.toString('utf8') };
      clearRemember();
      try { await vault.save(credentials, profile.fingerprint()); await vaultStatus('SAVED'); }
      catch { vaultState({ message: 'SAVE_FAILED' }); }
      finally { credentials.username = ''; credentials.password = ''; }
    }
    await openProtectedSession();
    state(casPrefill.completed ? 'CAS_PREFILLED' : 'READY');
  } else { throw new Error('control-frame'); }
}
function submitCredentials(credentials) {
  authPending = false;
  casPrefill.capture(credentials);
  const user = Buffer.from(credentials.username, 'utf8'), password = Buffer.from(credentials.password, 'utf8');
  send(`UI_CREDENTIALS ${user.toString('hex')} ${password.toString('hex')}`);
  user.fill(0); password.fill(0); credentials.username = ''; credentials.password = '';
  state('CONNECTING');
  return true;
}
ipcMain.handle('myneige:connect', (event, credentials, remember = false) => {
  if (!trusted(event) || !authPending || vaultBusy || typeof remember !== 'boolean' || !validateCredentials(credentials)) throw new Error('Soumission refusée.');
  profile.start(); clearRemember();
  if (remember) {
    rememberPending = { user: Buffer.from(credentials.username), password: Buffer.from(credentials.password) };
    rememberTimer = setTimeout(clearRemember, 180000); rememberTimer.unref();
  }
  return submitCredentials(credentials);
});
ipcMain.handle('myneige:vault-status', event => { if (!trusted(event)) throw new Error('Action refusée.'); return vaultStatus(); });
ipcMain.handle('myneige:vault-unlock', async event => {
  if (!trusted(event) || !authPending || vaultBusy || stopping) throw new Error('Action refusée.');
  vaultBusy = true; const epoch = vaultEpoch;
  try {
    const bytes = form.getNativeWindowHandle();
    const handle = bytes.length === 8 ? bytes.readBigUInt64LE() : BigInt(bytes.readUInt32LE());
    const credentials = await vault.unlock(handle, profile.fingerprint());
    if (!credentials) return { connected: false, message: 'DENIED' };
    try {
      if (epoch !== vaultEpoch || stopping || !trusted(event) || !authPending) return { connected: false, message: 'DENIED' };
      vaultBusy = false; profile.start(); submitCredentials(credentials); return { connected: true };
    } finally { credentials.username = ''; credentials.password = ''; }
  } catch { return { connected: false, message: 'UNAVAILABLE' }; }
  finally { vaultBusy = false; }
});
ipcMain.handle('myneige:vault-forget', async event => {
  if (!trusted(event) || stopping) throw new Error('Action refusée.');
  ++vaultEpoch; clearRemember(); casPrefill.clear(); vault.cancelActive();
  try { await vault.forget(); return await vaultStatus('DELETED'); }
  catch { vaultState({ message: 'DELETE_FAILED' }); return { message: 'DELETE_FAILED' }; }
});
ipcMain.on('myneige:disconnect', event => { if (trusted(event)) { send('UI_STOP'); shutdown(); } });
registerCasIPC(ipcMain, prefillOwners);
app.on('login', (event, _contents, _details, info, callback) => {
  event.preventDefault();
  if (info.isProxy && info.host === '127.0.0.1' && info.port === proxyPort && proxySecret) {
    send('UI_PROXY_AUTH MATCHED'); callback('myneige', proxySecret);
  }
  else callback();
});
async function openProtectedSession() {
  webSession = session.fromPartition(`navigation-${Date.now()}`, { cache: false });
  webSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  webSession.setPermissionCheckHandler(() => false);
  downloads = createDownloads({ session: webSession, ready: () => vpnReady && !stopping,
    directory: app.getPath('downloads'), show: () => downloadsWindow.show(), report: status => send(`UI_DOWNLOAD ${status}`) });
  downloadsWindow = createDownloadsWindow({ BrowserWindow, ipcMain, localSession: formSession, downloads, show: !testMode });
  protectRequests(webSession, host => send(`UI_DOMAIN ${host}`), metadata => send(`UI_REQUEST_BLOCKED ${metadata}`));
  const requestErrors = new Set();
  webSession.webRequest.onCompleted(details => {
    if (details.resourceType === 'mainFrame' && allowedURL(details.url)) send(`UI_PAGE ${new URL(details.url).hostname} ${details.statusCode}`);
  });
  webSession.webRequest.onErrorOccurred(details => {
    const error = networkError(details.error), metadata = requestMetadata(details);
    const key = metadata && `${metadata} ${error}`;
    if (key && requestErrors.size < 64 && !requestErrors.has(key)) {
      requestErrors.add(key); send(`UI_REQUEST_ERROR ${key}`);
    }
    if (details.resourceType === 'mainFrame') send(`UI_NET_ERROR ${error}`);
  });
  await webSession.setProxy({ mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${proxyPort};https=127.0.0.1:${proxyPort}`, proxyBypassRules: '<-loopback>' });
  for (const url of [START_URL, 'https://cas.univ-avignon.fr/', 'https://127.0.0.1/']) {
    if (await webSession.resolveProxy(url) !== `PROXY 127.0.0.1:${proxyPort}`) throw new Error('proxy-fallback');
  }
  await webSession.closeAllConnections();
  remote = protectedWindow();
  remote.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (mainFrame) send(`UI_NET_ERROR ${networkError(description)} code=${Number.isInteger(code) ? code : 0}`);
  });
  await remote.loadURL(START_URL);
}
function protectedWindow(browserSession = webSession, prefiller = casPrefill) {
  return createProtectedWindow({ BrowserWindow, session: browserSession, prefiller, owners: prefillOwners, show: !testMode,
    downloads: browserSession === webSession ? downloads : undefined, ready: () => (testMode || vpnReady) && !stopping,
    mailReport: metadata => send(`UI_MAIL_SSO ${metadata}`), checkUpdates: manualUpdateCheck });
}
function ensureUpdateToast() {
  updateToast ??= createUpdateToast({ BrowserWindow, ipcMain, screen, dialog, localSession: formSession,
    action: choice => updates?.action(choice) ?? { ok: false }, show: !testMode });
  return updateToast;
}
async function manualUpdateCheck() {
  if (stopping || !form || form.isDestroyed()) return;
  const toast = ensureUpdateToast();
  if (!UPDATE_CHECK_ENABLED) { await toast.status('coming'); return; }
  if (!vpnReady) { await toast.status('unavailable'); return; }
  try {
    if (!updates) startUpdates(false);
    const result = await updates.check({ manual: true });
    if (['current', 'error'].includes(result.status)) await toast.status(result.status);
  } catch { await toast.status('error'); }
}
function startUpdates(automatic = true) {
  if (!UPDATE_CHECK_ENABLED) return;
  if (updates) return;
  const transport = createUpdateTransport({ net: electronNet,
    session: session.fromPartition(`updates-${Date.now()}`, { cache: false }),
    port: proxyPort, secret: proxySecret, ready: () => vpnReady && !stopping });
  updates = createUpdateService({ installed: metadata, transport,
    // Le superviseur place userData dans MyNEIGE/browser-data/<session>.
    preferenceFile: path.resolve(app.getPath('userData'), '../../update-preferences.json'),
    openExternal: url => shell.openExternal(url), notify: candidate => updateToast.notify(candidate) });
  ensureUpdateToast();
  if (automatic) void updates.check();
}
function stopUpdates() { updates?.stop(); updates = undefined; updateToast?.dispose(); updateToast = undefined; }
async function expireSession() {
  vpnReady = false; authPending = false; proxySecret = undefined;
  stopUpdates();
  ++vaultEpoch; clearRemember(); profile?.stop(); vault?.stop(); casPrefill.clear(); downloads?.stop();
  downloadsWindow?.dispose();
  // Le formulaire n'utilise qu'une session locale interdisant le réseau.
  // Détruire aussi les pop-ups et les PDF, pas seulement la fenêtre principale.
  for (const window of BrowserWindow.getAllWindows()) if (window !== form) window.destroy();
  if (form && !form.isDestroyed()) {
    state('SESSION_EXPIRED');
    if (form.isMinimized()) form.restore();
    if (!testMode) { form.show(); form.focus(); }
  }
  if (webSession) {
    await webSession.closeAllConnections();
    await webSession.clearStorageData();
  }
}
function shutdown(failed = false) {
  if (stopping) return;
  stopping = true; authPending = false; proxySecret = undefined;
  sessionLifecycle?.dispose();
  stopUpdates();
  ++vaultEpoch; clearRemember(); profile?.stop(); vault?.stop();
  vpnReady = false; casPrefill.clear();
  downloads?.stop();
  downloadsWindow?.dispose();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (webSession) webSession.closeAllConnections().finally(() => app.exit(failed ? 1 : 0)); else app.exit(failed ? 1 : 0);
}
app.on('window-all-closed', () => { if (!stopping) { send('UI_STOP'); shutdown(); } });
process.on('uncaughtException', () => { send('UI_ERROR UNEXPECTED'); shutdown(true); });
process.on('unhandledRejection', () => { send('UI_ERROR UNEXPECTED'); shutdown(true); });
