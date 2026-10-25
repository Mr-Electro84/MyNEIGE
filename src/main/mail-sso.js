'use strict';
// Aucun contenu de formulaire, cookie ou paramètre SSO n'est conservé ici.
const MAIL_URL = 'https://partage.univ-avignon.fr/';
const MAIL_HOST = 'partage.univ-avignon.fr';
const SP_HOST = 'sp.partage.renater.fr';
const IDP_HOST = 'idp.univ-avignon.fr';
const hosts = new Set([MAIL_HOST, SP_HOST, IDP_HOST, 'cas.univ-avignon.fr', 'webmail.partage.renater.fr']);
const sessions = new WeakMap();
const bindings = new WeakMap();
function address(value, base) { try { return new URL(value, base); } catch { return null; } }
function secureHost(url, host) {
  return url?.protocol === 'https:' && url.hostname === host && !url.username && !url.password && !url.port;
}
function mailMetadata(event, url, method = 'OTHER', status = 0) {
  const parsed = address(url);
  const protocol = ['https:', 'http:'].includes(parsed?.protocol) ? parsed.protocol.slice(0, -1) : 'other';
  const host = hosts.has(parsed?.hostname) ? parsed.hostname : 'other';
  return `${event} ${protocol} ${host} ${['GET', 'POST'].includes(method) ? method : 'OTHER'} ${Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0}`;
}
function createMailSso({ contents, ready, report = () => {}, delay = 1200,
  schedule = setTimeout, unschedule = clearTimeout, now = Date.now }) {
  let flow, timer;
  const clearTimer = () => { if (timer !== undefined) unschedule(timer); timer = undefined; };
  const active = () => {
    if (flow && (now() > flow.expires || contents.isDestroyed() || !ready())) cancel();
    return Boolean(flow);
  };
  const log = (event, url, method, status) => {
    if (flow && flow.records++ < 128) report(mailMetadata(event, url, method, status));
  };
  function cancel() { clearTimer(); flow = undefined; }
  function settled() {
    clearTimer();
    if (!active() || !flow.returned || !flow.interrupted || flow.recovered) return;
    const expected = flow;
    timer = schedule(() => {
      timer = undefined;
      if (!active() || flow !== expected || contents.isLoading() || !flow.interrupted) return;
      flow.recovered = true;
      flow.interrupted = false;
      log('RECOVER', MAIL_URL, 'GET');
      // URL fixe et GET neuf, même WebContents/session. Ne jamais recharger le POST SAML.
      void contents.loadURL(MAIL_URL).catch(() => {});
    }, delay);
  }
  const api = {
    open(url) {
      cancel();
      if (url === MAIL_URL && ready()) {
        flow = { expires: now() + 10 * 60 * 1000, records: 0, sawIdp: false, exchange: false, returned: false, interrupted: false, recovered: false };
        log('OPEN', MAIL_URL, 'GET');
      }
    },
    cancel,
    request(event, details, allowed = true) {
      if (!active() || details.resourceType !== 'mainFrame') return;
      const url = address(details.url);
      log(event, details.url, details.method, details.statusCode);
      if (!hosts.has(url?.hostname)) { cancel(); return; }
      if (event === 'REQUEST') {
        if (secureHost(url, IDP_HOST)) { flow.sawIdp = true; flow.exchange = false; flow.returned = false; }
        if (flow.exchange && !(details.method === 'GET' && (secureHost(url, SP_HOST) || secureHost(url, MAIL_HOST)))) {
          flow.exchange = false; flow.returned = false;
        }
        if (!allowed) { flow.interrupted = url.hostname === MAIL_HOST; settled(); }
      } else if (event === 'RESPONSE') {
        // Le SP accuse réception du POST puis peut rediriger plusieurs fois
        // vers lui-même avant PARTAGE (parcours réel : POST 302, GET 301/302).
        const location = Object.entries(details.responseHeaders || {}).find(([key]) => key.toLowerCase() === 'location')?.[1]?.[0];
        const target = location && address(location, details.url);
        if (target) log('TARGET', target.href, 'OTHER', details.statusCode);
        const mailTarget = target?.hostname === MAIL_HOST && ['https:', 'http:'].includes(target.protocol) &&
          !target.username && !target.password && !target.port;
        if (flow.sawIdp && secureHost(url, SP_HOST)) {
          const acceptedPost = details.method === 'POST' && [302, 303].includes(details.statusCode);
          const continuation = flow.exchange && details.method === 'GET' && [301, 302, 303].includes(details.statusCode);
          if ((acceptedPost || continuation) && (secureHost(target, SP_HOST) || mailTarget)) {
            flow.exchange = true;
            if (mailTarget) flow.returned = true;
          } else { flow.exchange = false; flow.returned = false; }
        }
        if (details.statusCode >= 400) cancel();
      }
    },
    guard(event, url, blocked, mainFrame) {
      if (!active() || !mainFrame) return;
      log(blocked ? 'BLOCK' : event, url);
      const target = address(url);
      if (!hosts.has(target?.hostname)) { cancel(); return; }
      if (blocked) { flow.interrupted = target.hostname === MAIL_HOST; settled(); }
    }
  };
  contents.on('did-start-navigation', (_event, _url, _same, mainFrame) => {
    if (mainFrame && active()) { clearTimer(); flow.interrupted = false; }
  });
  contents.on('did-fail-provisional-load', (_event, code, _description, url, mainFrame) => {
    if (!mainFrame || !active()) return;
    log('FAIL', url);
    if (code !== -3) { cancel(); return; }
    // Le POST peut remplacer le chargement précédent de l'IdP : ce n'est pas
    // un échec du retour PARTAGE et cela ne doit pas effacer son suivi.
    if (address(url)?.hostname !== MAIL_HOST) return;
    flow.interrupted = true; settled();
  });
  contents.on('did-navigate', (_event, url, status) => {
    if (!active()) return;
    log('COMMIT', url, 'OTHER', status);
    const host = address(url)?.hostname;
    if (host === MAIL_HOST || host === 'webmail.partage.renater.fr' || !hosts.has(host) || status >= 400) cancel();
  });
  contents.on('did-stop-loading', settled);
  contents.on('before-input-event', (_event, input) => {
    if (input.key === 'Escape' || (input.alt && ['ArrowLeft', 'ArrowRight', 'Home'].includes(input.key))) cancel();
  });
  contents.once('destroyed', cancel);
  return api;
}
function installMailSso(options) {
  const tracker = createMailSso(options);
  const { contents } = options;
  let trackers = sessions.get(contents.session);
  if (!trackers) { trackers = new Map(); sessions.set(contents.session, trackers); }
  trackers.set(contents.id, tracker);
  bindings.set(contents, tracker);
  contents.once('destroyed', () => trackers.delete(contents.id));
  return tracker;
}
function observeMailRequest(session, event, details, allowed) {
  sessions.get(session)?.get(details.webContentsId)?.request(event, details, allowed);
}
module.exports = { MAIL_URL, createMailSso, installMailSso, observeMailRequest, mailMetadata, mailSsoFor: contents => bindings.get(contents) };
