'use strict';
const { app, BrowserWindow, ipcMain, session, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const dgram = require('node:dgram');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { START_URL, allowedURL, validateCredentials } = require('./policy');

// Network restrictions already exist in WFP before this process starts.
app.enableSandbox();
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
const domains = new Set();
const networkErrors = new Set(['ERR_FAILED', 'ERR_ABORTED', 'ERR_BLOCKED_BY_CLIENT', 'ERR_ACCESS_DENIED',
  'ERR_NETWORK_ACCESS_DENIED', 'ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_PROXY_AUTH_REQUESTED', 'ERR_PROXY_AUTH_UNSUPPORTED', 'ERR_NO_SUPPORTED_PROXIES',
  'ERR_INVALID_AUTH_CREDENTIALS', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_TIMED_OUT', 'ERR_TIMED_OUT', 'ERR_NAME_NOT_RESOLVED', 'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_COMMON_NAME_INVALID', 'ERR_CERT_DATE_INVALID', 'ERR_SSL_PROTOCOL_ERROR']);
let channel;
const send = value => (channel || process.stdout).write(`${value}\n`);
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
    await app.whenReady();
    send('BROWSER_STAGE APP_READY');
    await quarantineTests(v4, v6);
    send('BROWSER_STAGE NETWORK_BLOCKED');
    await testChild(v4, v6);
    send('BROWSER_STAGE CHILD_BLOCKED');
    const localSession = session.fromPartition(`form-${Date.now()}`, { cache: false });
    localSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') }));
    form = new BrowserWindow({ title: 'MyNEIGE · Pilote Windows', width: 620, height: 790, show: !testMode,
      webPreferences: { session: localSession, preload: path.join(__dirname, '../preload/form.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
    send('BROWSER_STAGE FORM_CREATED');
    form.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    form.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    form.webContents.on('will-navigate', event => event.preventDefault());
    form.on('closed', () => { form = null; if (!stopping) { send('UI_STOP'); shutdown(); } });
    await form.loadFile(formPath);
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
  } else if (line === 'AUTH_REQUIRED' && form) {
    authPending = true; state('AUTH_REQUIRED');
  } else if (parts[0] === 'STATE' && parts.length === 2 && ['BLOCKED', 'ERROR', 'CONNECTING'].includes(parts[1])) {
    state(parts[1]);
    if (parts[1] === 'BLOCKED' && remote && !remote.isDestroyed()) remote.destroy();
  } else if (parts[0] === 'VPN_READY' && parts.length === 3 && form && !proxySecret) {
    proxyPort = Number(parts[1]); proxySecret = parts[2];
    if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535 || !/^[a-f0-9]{64}$/.test(proxySecret)) throw new Error('proxy');
    await openProtectedSession();
    state('READY');
  } else { throw new Error('control-frame'); }
}
ipcMain.handle('myneige:connect', (event, credentials) => {
  if (!trusted(event) || !authPending || !validateCredentials(credentials)) throw new Error('Soumission refusée.');
  authPending = false;
  const user = Buffer.from(credentials.username, 'utf8'), password = Buffer.from(credentials.password, 'utf8');
  send(`UI_CREDENTIALS ${user.toString('hex')} ${password.toString('hex')}`);
  user.fill(0); password.fill(0); credentials.username = ''; credentials.password = '';
  state('CONNECTING');
  return true;
});
ipcMain.on('myneige:disconnect', event => { if (trusted(event)) { send('UI_STOP'); shutdown(); } });
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
  webSession.on('will-download', event => event.preventDefault());
  webSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = allowedURL(details.url);
    if (allowed) {
      const host = new URL(details.url).hostname;
      if (!domains.has(host)) { domains.add(host); send(`UI_DOMAIN ${host}`); }
    }
    callback({ cancel: !allowed });
  });
  webSession.webRequest.onCompleted(details => {
    if (details.resourceType === 'mainFrame' && allowedURL(details.url)) send(`UI_PAGE ${new URL(details.url).hostname} ${details.statusCode}`);
  });
  webSession.webRequest.onErrorOccurred(details => {
    if (details.resourceType === 'mainFrame') send(`UI_NET_ERROR ${networkErrors.has(details.error) ? details.error : 'OTHER'}`);
  });
  await webSession.setProxy({ mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${proxyPort};https=127.0.0.1:${proxyPort}`, proxyBypassRules: '<-loopback>' });
  for (const url of [START_URL, 'https://cas.univ-avignon.fr/', 'https://127.0.0.1/']) {
    if (await webSession.resolveProxy(url) !== `PROXY 127.0.0.1:${proxyPort}`) throw new Error('proxy-fallback');
  }
  await webSession.closeAllConnections();
  remote = protectedWindow();
  remote.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (mainFrame) send(`UI_NET_ERROR ${networkErrors.has(description) ? description : 'OTHER'} code=${Number.isInteger(code) ? code : 0}`);
  });
  await remote.loadURL(START_URL);
}
function protectedWindow() {
  const window = new BrowserWindow({ title: 'MyNEIGE · Navigation universitaire', width: 1200, height: 850, show: !testMode,
    webPreferences: { session: webSession, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webRTCIPHandlingPolicy: 'disable_non_proxied_udp', navigateOnDragDrop: false } });
  window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate']) window.webContents.on(event, (event, url) => { if (!allowedURL(typeof url === 'string' ? url : event.url)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedURL(url)) { const popup = protectedWindow(); popup.loadURL(url).catch(() => {}); }
    return { action: 'deny' };
  });
  return window;
}
function shutdown(failed = false) {
  if (stopping) return;
  stopping = true; authPending = false; proxySecret = undefined;
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (webSession) webSession.closeAllConnections().finally(() => app.exit(failed ? 1 : 0)); else app.exit(failed ? 1 : 0);
}
app.on('window-all-closed', () => { if (!stopping) { send('UI_STOP'); shutdown(); } });
process.on('uncaughtException', () => { send('UI_ERROR UNEXPECTED'); shutdown(true); });
process.on('unhandledRejection', () => { send('UI_ERROR UNEXPECTED'); shutdown(true); });
