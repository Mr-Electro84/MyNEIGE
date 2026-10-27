'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const tcp = require('node:net');
const { app, session, BrowserWindow, ipcMain, net, screen } = require('electron');
const { ENDPOINTS, SITE, createUpdateTransport, createUpdateService } = require('../src/main/updates');
const { createUpdateToast } = require('../src/main/update-toast');
const { helpMenu } = require('../src/main/about');
const { installNavigation } = require('../src/main/navigation');
const { Menu } = require('electron');
app.enableSandbox();
app.setPath('userData', path.resolve(__dirname, '../.local/updates-data'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1');
app.commandLine.appendSwitch('disable-background-networking');
app.on('window-all-closed', () => {});
const timer = setTimeout(() => { console.error('UPDATES_TEST timeout'); app.exit(1); }, 30000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 150; i++) { if (await predicate()) return; await pause(20); }
  throw new Error('Événement attendu absent');
}
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
app.whenReady().then(async () => {
  let mode = 'normal', ready = true, authenticated = 0, requestCount = 0;
  const secret = 'a'.repeat(64), seen = [];
  const server = https.createServer({ key: fs.readFileSync(path.join(__dirname, 'fixtures/mail-sso-key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'fixtures/mail-sso-cert.pem')) }, (request, response) => {
    seen.push(request.url); assert.equal(request.headers.cookie, undefined);
    if (mode === 'timeout') return;
    if (mode === 'redirect') { response.writeHead(302, { Location: 'https://example.invalid/escape' }); response.end(); return; }
    if (mode === 'large') { response.end('x'.repeat(8193)); return; }
    if (mode === 'http-error') { response.writeHead(503); response.end(); return; }
    response.end(request.url.includes('flag=goto') ? 'https://example.org/MyNEIGE.exe' :
      '{"version":"1.0.2-alpha.1","revision":2}');
  });
  await listen(server);
  const proxy = http.createServer();
  proxy.on('connect', (request, socket, head) => {
    requestCount++;
    assert.equal(request.url, 'my-neige.42web.io:443');
    if (request.headers['proxy-authorization'] !== `Basic ${Buffer.from(`myneige:${secret}`).toString('base64')}`) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="fixture"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'); return;
    }
    authenticated++;
    const upstream = tcp.connect(server.address().port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
  });
  await listen(proxy);
  const network = session.fromPartition('updates-network-fixture', { cache: false });
  // Exception TLS limitée à cette session de test et à ce seul hôte.
  network.setCertificateVerifyProc((request, callback) => callback(request.hostname === 'my-neige.42web.io' ? 0 : -2));
  const transport = createUpdateTransport({ net, session: network, port: proxy.address().port, secret,
    ready: () => ready, timeout: 5000 });
  assert.equal(JSON.parse(await transport.get('version')).revision, 2); assert(authenticated > 0);
  const before = requestCount;
  await assert.rejects(network.fetch('https://example.invalid/escape')); assert.equal(requestCount, before);
  for (const value of ['redirect', 'large', 'http-error', 'timeout']) {
    mode = value; await assert.rejects(transport.get('version'));
  }
  mode = 'normal';
  const local = session.fromPartition('updates-local-fixture', { cache: false });
  local.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') }));
  const directory = path.resolve(__dirname, '../.local/updates'); fs.mkdirSync(directory, { recursive: true });
  const preferences = path.join(directory, 'preferences.json'); fs.rmSync(preferences, { force: true });
  const opened = [], alerts = [];
  let toast;
  const service = createUpdateService({ installed: { version: '1.0.1-alpha.1', revision: 1 }, transport,
    preferenceFile: preferences, openExternal: async url => opened.push(url), notify: candidate => toast.notify(candidate) });
  toast = createUpdateToast({ BrowserWindow, ipcMain, screen, localSession: local, show: false,
    openExternal: async url => opened.push(url),
    dialog: { showMessageBox: async (_window, options) => { alerts.push(options.message); } }, action: value => service.action(value) });
  await service.check();
  const window = BrowserWindow.getAllWindows()[0]; assert(window);
  await until(() => window.webContents.executeJavaScript('document.getElementById("update-version").textContent.includes("1.0.2")'));
  assert.equal(await window.webContents.executeJavaScript('typeof require'), 'undefined');
  assert.equal(await window.webContents.executeJavaScript('typeof window.myneige'), 'undefined');
  assert(await window.webContents.executeJavaScript('document.documentElement.scrollHeight <= innerHeight'), 'Toast tronqué');
  // Un contenu local étranger ne peut pas déclencher les actions du toast.
  const foreign = new BrowserWindow({ show: false, webPreferences: { session: local, sandbox: true,
    preload: path.resolve(__dirname, '../src/preload/update-toast.js'), contextIsolation: true } });
  await foreign.loadFile(path.resolve(__dirname, '../src/renderer/update-toast.html'));
  assert.deepEqual(await foreign.webContents.executeJavaScript('window.myneigeUpdate.action("never")'), { ok: false });
  assert.deepEqual(await foreign.webContents.executeJavaScript('window.myneigeUpdate.action("website")'), { ok: false }); foreign.destroy();
  window.showInactive(); await pause(200);
  fs.writeFileSync(path.join(directory, 'toast.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript('document.getElementById("update-never").click()');
  await until(() => window.isDestroyed()); assert.equal(alerts.length, 1); assert.match(alerts[0], /https:\/\/my-neige.42web.io\//);
  assert.equal(JSON.parse(fs.readFileSync(preferences)).disabled, true); assert.deepEqual(opened, []);
  // Le menu relance le contrôle malgré le refus des rappels automatiques.
  const host = new BrowserWindow({ show: false });
  let manualChecks = 0;
  const checkUpdates = async () => {
    manualChecks++;
    const result = await service.check({ manual: true });
    if (['current', 'error'].includes(result.status)) await toast.status(result.status);
  };
  const formMenu = Menu.buildFromTemplate([helpMenu(host, undefined, { checkUpdates })]);
  assert.equal(formMenu.getMenuItemById('check-updates').label, 'Vérifier les mises à jour');
  formMenu.getMenuItemById('check-updates').click();
  await until(() => BrowserWindow.getAllWindows().some(window => window.getTitle() === 'MyNEIGE · Mise à jour'));
  let manualToast = BrowserWindow.getAllWindows().find(window => window !== host);
  await until(() => manualToast.webContents.executeJavaScript('document.getElementById("update-version").textContent.includes("1.0.2")'));
  assert.equal(JSON.parse(fs.readFileSync(preferences)).disabled, true);
  await manualToast.webContents.executeJavaScript('document.getElementById("update-later").click()');
  await until(() => manualToast.isDestroyed());
  // Le même callback est également branché sur le menu universitaire.
  const navigation = installNavigation({ window: host, Menu, ready: () => true, checkUpdates });
  const get = transport.get.bind(transport);
  transport.get = async () => '{"version":"1.0.1-alpha.1","revision":1}';
  navigation.menu.getMenuItemById('check-updates').click();
  await until(() => BrowserWindow.getAllWindows().some(window => window !== host));
  manualToast = BrowserWindow.getAllWindows().find(window => window !== host);
  await until(() => manualToast.webContents.executeJavaScript('document.getElementById("update-title").textContent === "MyNEIGE est à jour"'));
  assert(await manualToast.webContents.executeJavaScript('document.getElementById("update-actions").hidden && !document.getElementById("update-close").hidden'));
  transport.get = async () => { throw new Error('Panne simulée'); };
  formMenu.getMenuItemById('check-updates').click();
  await until(() => manualToast.webContents.executeJavaScript('document.getElementById("update-title").textContent === "Vérification impossible"'));
  await manualToast.webContents.executeJavaScript('document.getElementById("update-close").click()');
  await until(() => manualToast.isDestroyed());
  assert.equal(manualChecks, 3);
  transport.get = get;
  await toast.status('coming');
  const comingToast = BrowserWindow.getAllWindows().find(window => window !== host);
  await until(() => comingToast.webContents.executeJavaScript('document.getElementById("update-title").textContent === "Fonctionnalité à venir"'));
  assert(await comingToast.webContents.executeJavaScript('document.getElementById("update-actions").hidden && !document.getElementById("update-website").hidden && !document.getElementById("update-close").hidden'));
  assert(await comingToast.webContents.executeJavaScript('document.documentElement.scrollHeight <= innerHeight'), 'Annonce tronquée');
  comingToast.showInactive(); await pause(200);
  fs.writeFileSync(path.join(directory, 'coming.png'), (await comingToast.webContents.capturePage()).toPNG());
  await comingToast.webContents.executeJavaScript('document.getElementById("update-website").click()');
  await until(() => comingToast.isDestroyed()); assert.deepEqual(opened, [SITE]);
  host.destroy();
  toast.dispose(); service.stop();
  ready = false; await assert.rejects(transport.get('version'));
  server.close(); proxy.close();
  assert(seen.every(url => Object.values(ENDPOINTS).some(endpoint => endpoint.endsWith(url))));
  console.log('UPDATES_TEST passed proxy_auth=true no_local_dns=true redirects_blocked=true limits=true toast=true trusted_ipc=true preference=true manual_menu=true no_real_vpn=true');
}).then(() => { clearTimeout(timer); app.exit(0); }).catch(error => {
  clearTimeout(timer); console.error('UPDATES_TEST failed: ' + error.stack); app.exit(1);
});
