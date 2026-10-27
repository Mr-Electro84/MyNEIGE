'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { externalURL } = require('./policy');
const API = 'https://my-neige.42web.io/update.php';
const SITE = 'https://my-neige.42web.io/';
// En attente d'un hébergement d'API compatible avec les requêtes applicatives.
const UPDATE_CHECK_ENABLED = false;
const ENDPOINTS = Object.freeze({ version: `${API}?flag=version`, goto: `${API}?flag=goto` });

function parseVersion(text) {
  const value = JSON.parse(text);
  if (!value || typeof value.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version) || value.version.length > 80 ||
      !Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error('Réponse de version invalide.');
  return { version: value.version, revision: value.revision };
}
function parseDownload(text) {
  let value = text.trim();
  if (value.startsWith('{') || value.startsWith('"')) {
    const json = JSON.parse(value); value = typeof json === 'string' ? json : json?.url;
  }
  if (typeof value !== 'string' || !value.startsWith('https://') || !externalURL(value))
    throw new Error('Lien de téléchargement invalide.');
  return new URL(value).href;
}

// Session dédiée sans cookies universitaires ; aucune requête de secours directe.
function createUpdateTransport({ net, session, port, secret, ready, timeout = 10000 }) {
  const pending = new Set();
  let stopped = false;
  const expected = `PROXY 127.0.0.1:${port}`;
  session.webRequest.onBeforeRequest((details, callback) => callback({ cancel:
    stopped || !ready() || !Object.values(ENDPOINTS).includes(details.url) }));
  const configured = session.setProxy({ mode: 'fixed_servers',
    proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' })
    .then(() => true, () => false);
  return {
    async get(flag) {
      const url = ENDPOINTS[flag];
      if (!url || stopped || !ready()) throw new Error('Mise à jour indisponible.');
      if (!await configured) throw new Error('Configuration du relais impossible.');
      if (await session.resolveProxy(url) !== expected || stopped || !ready()) throw new Error('Relais indisponible.');
      return new Promise((resolve, reject) => {
        const request = net.request({ url, session, method: 'GET', redirect: 'error', useSessionCookies: false });
        let done = false;
        const finish = (error, text) => {
          if (done) return;
          done = true; clearTimeout(timer); pending.delete(cancel);
          if (error) { reject(error); request.abort(); } else resolve(text);
        };
        const cancel = () => finish(new Error('Vérification interrompue.'));
        const timer = setTimeout(cancel, timeout);
        pending.add(cancel);
        request.on('login', (info, callback) => {
          if (!stopped && ready() && info.isProxy && info.host === '127.0.0.1' && info.port === port)
            callback('myneige', secret);
          else callback();
        });
        request.on('error', () => finish(new Error('API indisponible.')));
        request.on('response', response => {
          if (response.statusCode !== 200) { finish(new Error('Réponse HTTP invalide.')); return; }
          const chunks = []; let size = 0;
          response.on('data', chunk => {
            size += chunk.length;
            if (size > 8192) finish(new Error('Réponse trop volumineuse.'));
            else chunks.push(chunk);
          });
          response.on('error', () => finish(new Error('Réponse interrompue.')));
          response.on('end', () => finish(stopped || !ready() ? new Error('Relais indisponible.') : null,
            Buffer.concat(chunks).toString('utf8')));
        });
        request.setHeader('Accept', 'application/json, text/plain');
        request.setHeader('Cache-Control', 'no-cache');
        request.end();
      });
    },
    stop() { stopped = true; for (const cancel of pending) cancel(); void session.closeAllConnections().catch(() => {}); }
  };
}

function createUpdateService({ installed, preferenceFile, transport, openExternal, notify }) {
  let stopped = false, checked = false, checking = false, offer = null, busy = false;
  return {
    async check({ manual = false } = {}) {
      if (stopped) return { status: 'stopped' };
      if (checking || busy) return { status: 'busy' };
      if (!manual && checked) return { status: 'skipped' };
      checking = true;
      if (!manual) checked = true;
      try {
        let disabled = false;
        // Un clic explicite ignore le refus des rappels sans modifier ce choix.
        if (!manual) {
          try { disabled = JSON.parse(await fs.readFile(preferenceFile, 'utf8')).disabled === true; }
          catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) return { status: 'error' }; }
        }
        if (disabled || stopped) return { status: 'skipped' };
        const candidate = parseVersion(await transport.get('version'));
        if (stopped) return { status: 'stopped' };
        if (candidate.version === installed.version || candidate.revision <= installed.revision) {
          offer = null; return { status: 'current' };
        }
        offer = candidate; await notify(candidate);
        return { status: 'available' };
      } catch { return { status: stopped ? 'stopped' : 'error' }; }
      finally { checking = false; }
    },
    async action(action) {
      if (stopped || !offer || busy || checking || !['download', 'later', 'never'].includes(action)) return { ok: false };
      busy = true;
      try {
        if (action === 'download') {
          const url = parseDownload(await transport.get('goto'));
          if (stopped) return { ok: false };
          await openExternal(url);
        } else if (action === 'never') {
          await fs.mkdir(path.dirname(preferenceFile), { recursive: true });
          const temporary = `${preferenceFile}.tmp`;
          await fs.writeFile(temporary, JSON.stringify({ disabled: true }), { mode: 0o600 });
          await fs.rename(temporary, preferenceFile);
        }
        offer = null;
        return { ok: true, remind: action === 'never' };
      } catch { return { ok: false }; }
      finally { busy = false; }
    },
    stop() { stopped = true; offer = null; transport.stop(); }
  };
}
module.exports = { ENDPOINTS, SITE, UPDATE_CHECK_ENABLED, parseVersion, parseDownload, createUpdateTransport, createUpdateService };
