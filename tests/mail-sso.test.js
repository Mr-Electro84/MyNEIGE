'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MAIL_URL, createMailSso, mailMetadata } = require('../src/main/mail-sso');
const IDP = 'https://idp.univ-avignon.fr/idp/profile?secret=fixture';
const SP = 'https://sp.partage.renater.fr/SAML2/POST';
function fixture() {
  const contents = new EventEmitter(), calls = [], records = [], pending = new Map();
  let next = 0, time = 0, available = true, loading = false;
  Object.assign(contents, { isDestroyed: () => false, isLoading: () => loading,
    loadURL: async url => { calls.push(url); } });
  const tracker = createMailSso({ contents, ready: () => available, report: value => records.push(value),
    now: () => time, schedule: fn => { pending.set(++next, fn); return next; }, unschedule: id => pending.delete(id) });
  const request = (url, method = 'GET', resourceType = 'mainFrame') => tracker.request('REQUEST', { url, method, resourceType });
  const response = (statusCode = 302, target = MAIL_URL, extra = {}) => tracker.request('RESPONSE', {
    url: SP, method: 'POST', resourceType: 'mainFrame', statusCode, responseHeaders: { Location: [target] }, ...extra });
  return { contents, calls, records, tracker, request, response,
    open() { tracker.open(MAIL_URL); request(MAIL_URL); request(IDP); },
    fail() { contents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', MAIL_URL, true); contents.emit('did-stop-loading'); },
    flush() { const work = [...pending.values()]; pending.clear(); for (const fn of work) fn(); },
    setReady(value) { available = value; }, setTime(value) { time = value; }, setLoading(value) { loading = value; } };
}
test('retour POST SSO annulé : un seul GET fixe sans rejouer les paramètres ni le POST', () => {
  const f = fixture(); f.open();
  f.contents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', IDP, true);
  f.response(303, `${MAIL_URL}?ticket=secret`); f.fail(); f.flush();
  assert.deepEqual(f.calls, [MAIL_URL]);
  f.fail(); f.flush(); assert.equal(f.calls.length, 1);
  assert(f.records.some(value => value.startsWith('RECOVER https partage.univ-avignon.fr GET 0')));
  assert(!f.records.join(' ').includes('secret'));
});
test('sans intention Mail, sans retour POST exact ou avec échec HTTP, aucune reprise', () => {
  const invalid = [
    f => { f.request(IDP); f.response(); },
    f => { f.open(); },
    f => { f.open(); f.response(200); },
    f => { f.open(); f.response(403); },
    f => { f.open(); f.response(302, 'https://evil.test/'); },
    f => { f.open(); f.response(302, MAIL_URL, { method: 'GET' }); },
    f => { f.open(); f.response(302, MAIL_URL, { resourceType: 'subFrame' }); },
    f => { f.open(); f.response(302, MAIL_URL, { url: 'https://other.renater.fr/' }); },
    f => { f.open(); f.response(302, 'https://user:secret@partage.univ-avignon.fr/'); },
    f => { f.open(); f.response(302, 'https://partage.univ-avignon.fr:8443/'); },
    f => { f.open(); f.response(302, 'https://['); }
  ];
  for (const prepare of invalid) {
    const f = fixture(); prepare(f); f.fail(); f.flush(); assert.deepEqual(f.calls, []);
  }
});
test('un retour normal vers Mail annule la reprise en attente', () => {
  const f = fixture(); f.open(); f.response(); f.fail();
  f.contents.emit('did-navigate', {}, MAIL_URL, 200); f.flush(); assert.deepEqual(f.calls, []);
});
test('annulation, départ, expiration ou perte du VPN empêchent la reprise', () => {
  const changes = [
    f => f.tracker.cancel(),
    f => f.contents.emit('before-input-event', {}, { key: 'Escape' }),
    f => f.contents.emit('before-input-event', {}, { key: 'ArrowLeft', alt: true }),
    f => f.tracker.open('https://cloud.univ-avignon.fr/'),
    f => f.request('https://ent.univ-avignon.fr/'),
    f => f.tracker.guard('NAVIGATE', 'https://evil.test/', true, true),
    f => f.contents.emit('destroyed'),
    f => f.contents.emit('did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', MAIL_URL, true),
    f => f.setReady(false),
    f => f.setTime(600001)
  ];
  for (const change of changes) {
    const f = fixture(); f.open(); f.response(); f.fail(); change(f); f.flush(); assert.deepEqual(f.calls, []);
  }
});
test('une nouvelle navigation ou un chargement actif laisse la priorité au navigateur', () => {
  const f = fixture(); f.open(); f.response(); f.fail();
  f.contents.emit('did-start-navigation', {}, MAIL_URL, false, true); f.flush(); assert.deepEqual(f.calls, []);
  f.fail(); f.setLoading(true); f.flush(); assert.deepEqual(f.calls, []);
  f.setLoading(false); f.contents.emit('did-stop-loading'); f.flush(); assert.deepEqual(f.calls, [MAIL_URL]);
});
test('un retour HTTP bloqué garde le filtre HTTPS et reprend uniquement en HTTPS', () => {
  const f = fixture(); f.open(); f.response(302, 'http://partage.univ-avignon.fr/private?secret=1');
  f.tracker.guard('REDIRECT', 'http://partage.univ-avignon.fr/private?secret=1', true, true);
  f.flush(); assert.deepEqual(f.calls, [MAIL_URL]);
});
test('le parcours réel conserve la preuve du POST dans les redirections internes du SP', () => {
  const f = fixture(); f.open(); f.response(302, `${SP}?local=fixture`);
  f.request(SP); f.response(301, `${SP}/`, { method: 'GET' });
  f.request(`${SP}/`); f.response(302, MAIL_URL, { method: 'GET' });
  f.request(MAIL_URL);
  f.response(302, 'http://partage.univ-avignon.fr/private?ticket=secret', { url: MAIL_URL, method: 'GET' });
  f.tracker.guard('REDIRECT', 'http://partage.univ-avignon.fr/private?ticket=secret', true, true);
  f.flush(); assert.deepEqual(f.calls, [MAIL_URL]);
});
test('sortir de la chaîne exacte du SP ou y recevoir une page 200 invalide la preuve', () => {
  for (const interrupt of [f => f.request('https://cas.univ-avignon.fr/'),
    f => f.response(302, 'https://other.renater.fr/', { method: 'GET' }),
    f => f.response(200, SP, { method: 'GET' })]) {
    const f = fixture(); f.open(); f.response(302, SP); interrupt(f);
    f.response(302, MAIL_URL, { method: 'GET' }); f.fail(); f.flush(); assert.deepEqual(f.calls, []);
  }
});
test('diagnostics SSO bornés, domaines et champs contrôlés, sans données de compte', () => {
  assert.equal(mailMetadata('BLOCK', 'http://user:secret@partage.univ-avignon.fr/private?ticket=secret', 'secret', 999),
    'BLOCK http partage.univ-avignon.fr OTHER 0');
  assert.equal(mailMetadata('BLOCK', 'data:text/html,secret'), 'BLOCK other other OTHER 0');
  assert.equal(mailMetadata('BLOCK', 'https://secret.evil.test/'), 'BLOCK https other OTHER 0');
  const f = fixture(); f.open(); for (let i = 0; i < 200; i++) f.request(IDP);
  assert.equal(f.records.length, 128);
});
