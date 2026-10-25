'use strict';
// Serveur TLS et proxy CONNECT exclusivement sur loopback. La clé PEM fournie
// est publique et réservée aux fixtures : ce n'est jamais un certificat de production.
const { app, session, BrowserWindow } = require('electron');
const https = require('node:https');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const { createProtectedWindow } = require('../src/main/protected-window');
const { protectRequests } = require('../src/main/session-policy');
const { navigationFor } = require('../src/main/navigation');
const { MAIL_URL } = require('../src/main/mail-sso');
app.enableSandbox();
app.setPath('userData', path.resolve(__dirname, '../.local/mail-sso-data'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1');
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function until(check) {
  const deadline = Date.now() + 6000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Délai de la fixture TLS SSO dépassé'); await pause(20); }
}
const records = [], sockets = new Set();
let tlsServer, proxy;
function track(socket) { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); }
const timeout = setTimeout(() => { console.error('MAIL_SSO_TEST timeout'); app.exit(1); }, 35000);
async function run() {
  const cert = fs.readFileSync(path.join(__dirname, 'fixtures/mail-sso-cert.pem'));
  const pinned = new X509Certificate(cert).raw;
  const hosts = new Set(['partage.univ-avignon.fr', 'idp.univ-avignon.fr', 'sp.partage.renater.fr', 'cloud.univ-avignon.fr']);
  let scenario;
  tlsServer = https.createServer({ cert, key: fs.readFileSync(path.join(__dirname, 'fixtures/mail-sso-key.pem')) }, (request, response) => {
    const host = request.headers.host;
    const html = text => { response.writeHead(200, { 'content-type': 'text/html' }); response.end(text); };
    if (host === 'partage.univ-avignon.fr' && request.url === '/') {
      ++scenario.gets;
      if (scenario.gets > 1) {
        scenario.sameSession = (request.headers.cookie || '').includes('sso-fixture=1');
        html('<title>Mail recovered</title>'); return;
      }
      response.writeHead(302, { location: 'https://idp.univ-avignon.fr/login',
        'set-cookie': 'sso-fixture=1; Path=/; Secure; HttpOnly; SameSite=Lax' }); response.end();
    } else if (host === 'idp.univ-avignon.fr') {
      html('<form method="POST" action="https://sp.partage.renater.fr/consume"><input name="SAMLResponse" value="local-fixture"></form><script>document.forms[0].submit();</script>');
    } else if (host === 'sp.partage.renater.fr' && request.method === 'GET') {
      // Même chaîne que celle observée : POST SP 302, GET SP 301 puis 302
      // vers Mail HTTPS, qui redirige ensuite vers HTTP au premier retour.
      response.writeHead(request.url === '/resume' ? 301 : 302, {
        location: request.url === '/resume' ? 'https://sp.partage.renater.fr/resume/' : 'https://partage.univ-avignon.fr/sso-return'
      }); response.end();
    } else if (host === 'partage.univ-avignon.fr' && request.url === '/sso-return') {
      response.writeHead(302, { location: 'http://partage.univ-avignon.fr/landing?ticket=local-fixture' }); response.end();
    } else if (host === 'sp.partage.renater.fr') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        ++scenario.posts;
        scenario.validPost = request.method === 'POST' && body === 'SAMLResponse=local-fixture';
        if (scenario.mode === 'failed') { response.writeHead(403); response.end('SSO refused'); return; }
        response.writeHead(302, { location: scenario.mode === 'normal' ?
          'https://partage.univ-avignon.fr/landing?ticket=local-fixture' : 'https://sp.partage.renater.fr/resume' }); response.end();
      });
    } else html('<title>Normal destination</title>');
  });
  tlsServer.on('connection', track);
  await listen(tlsServer);
  proxy = http.createServer((_request, response) => { response.writeHead(403); response.end(); });
  proxy.on('connection', track);
  proxy.on('connect', (request, client, head) => {
    if (![...hosts].some(host => request.url === `${host}:443`)) { client.destroy(); return; }
    const upstream = net.connect(tlsServer.address().port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
    track(upstream);
    client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
  });
  await listen(proxy);
  let checks = 0;
  for (const mode of ['normal', 'blocked', 'cancel', 'escape', 'failed', 'no-intent', 'vpn-lost']) {
    scenario = { mode, gets: 0, posts: 0, sameSession: false, validPost: false };
    let ready = true;
    const browserSession = session.fromPartition(`mail-sso-${mode}-${Date.now()}`, { cache: false });
    browserSession.setCertificateVerifyProc(({ hostname, certificate }, callback) => {
      let valid = false;
      try { valid = hosts.has(hostname) && new X509Certificate(certificate.data).raw.equals(pinned); } catch { /* Refus. */ }
      callback(valid ? 0 : -2);
    });
    await browserSession.setProxy({ mode: 'fixed_servers', proxyRules: `127.0.0.1:${proxy.address().port}`, proxyBypassRules: '<-loopback>' });
    protectRequests(browserSession);
    const window = createProtectedWindow({ BrowserWindow, session: browserSession, prefiller: { bind() {} }, owners: new WeakMap(),
      show: false, ready: () => ready, mailReport: value => records.push(`${mode}: ${value}`) });
    const menu = navigationFor(window).menu;
    try {
      if (mode === 'no-intent') void window.loadURL(MAIL_URL).catch(() => {});
      else menu.getMenuItemById('university-mail').click();
      await until(() => scenario.posts === 1 && !window.webContents.isLoading());
      if (mode === 'cancel') {
        menu.getMenuItemById('university-nextcloud').click();
        await until(() => window.webContents.getURL() === 'https://cloud.univ-avignon.fr/' && !window.webContents.isLoading());
      }
      if (mode === 'escape') window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      if (mode === 'vpn-lost') ready = false;
      if (mode === 'blocked') await until(() => scenario.gets === 2 && !window.webContents.isLoading());
      await pause(1500); // Couvre le délai de reprise et détecte une boucle.
      assert(scenario.validPost, `POST intact : ${mode}`);
      assert.equal(scenario.posts, 1, `POST jamais rejoué : ${mode}`);
      assert.equal(scenario.gets, mode === 'blocked' ? 2 : 1, `Nombre de GET : ${mode}`);
      if (mode === 'blocked') {
        assert(scenario.sameSession); assert.equal(window.webContents.getURL(), MAIL_URL);
        assert.equal(await window.webContents.executeJavaScript('document.title'), 'Mail recovered');
      }
      if (mode === 'normal') assert.equal(new URL(window.webContents.getURL()).pathname, '/landing');
      if (mode === 'cancel') assert.equal(window.webContents.getURL(), 'https://cloud.univ-avignon.fr/');
      ++checks;
    } finally { window.destroy(); await browserSession.closeAllConnections(); }
  }
  return checks;
}
app.whenReady().then(run).then(checks => {
  console.log(`MAIL_SSO_TEST passed checks=${checks} loopback_only=true real_tls_headers=true`); finish(0);
}).catch(error => { console.error(error.stack); console.error(records.join('\n')); finish(1); });
function finish(code) {
  clearTimeout(timeout);
  for (const socket of sockets) socket.destroy();
  proxy?.close(); tlsServer?.close(); app.exit(code);
}
