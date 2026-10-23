'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { CasPrefill, casDocument, casEndpoint } = require('../src/main/cas-prefill');
const { START_URL } = require('../src/main/policy');
const LOGIN = 'https://cas.univ-avignon.fr/cas/login?service=' + encodeURIComponent(START_URL);
const NONCE = '12'.repeat(16);
function harness() {
  let now = 100, ready = true;
  const outcomes = [];
  const control = new CasPrefill({ now: () => now, ready: () => ready, report: value => outcomes.push(value) });
  const contents = new EventEmitter();
  contents.isDestroyed = () => false; contents.getURL = () => contents.mainFrame.url;
  contents.mainFrame = { url: LOGIN };
  control.bind(contents);
  control.capture({ username: 'pilot-fictif', password: 'fictif-"\\é</script>' });
  return { control, contents, event: { sender: contents, senderFrame: contents.mainFrame }, outcomes,
    expire: () => { now += 180001; }, block: () => { ready = false; } };
}
test('CAS prefill requires exact HTTPS endpoint and a single APPIGS service', () => {
  assert(casDocument(LOGIN)); assert(casEndpoint('https://cas.univ-avignon.fr:443/cas/login'));
  for (const url of [LOGIN.replace('https:', 'http:'), LOGIN.replace('cas.univ-avignon.fr', 'cas.univ-avignon.fr.evil.test'),
    LOGIN.replace('cas.univ-avignon.fr', 'services.univ-avignon.fr'), LOGIN.replace('/cas/login', '/cas/logout'),
    LOGIN.replace('https://cas.', 'https://user@cas.'), LOGIN + '#fragment', LOGIN + '&service=' + encodeURIComponent(START_URL),
    'https://cas.univ-avignon.fr/cas/login', 'https://cas.univ-avignon.fr/cas/login?service=https://evil.test/']) assert(!casDocument(url), url);
});
test('CAS credential lease is single-use, wipes buffers, and needs a matching result', () => {
  const h = harness(), user = h.control.user, password = h.control.password;
  const reply = h.control.request(h.event, NONCE);
  assert.equal(reply.username, 'pilot-fictif'); assert.equal(reply.password, 'fictif-"\\é</script>');
  assert(user.every(byte => byte === 0)); assert(password.every(byte => byte === 0));
  assert.equal(h.control.request(h.event, NONCE), null);
  h.control.outcome(h.event, { status: 'PREFILLED', nonce: '34'.repeat(16) });
  assert(!h.control.completed);
  h.control.outcome(h.event, { status: 'PREFILLED', nonce: NONCE });
  assert(h.control.completed); assert.deepEqual(h.outcomes, ['PREFILLED']);
});
test('subframes, unknown windows, changed origins and an unready VPN cannot consume the lease', () => {
  const h = harness();
  for (const nonce of [null, '', 'not-a-document-nonce', {}]) assert.equal(h.control.request(h.event, nonce), null);
  assert.equal(h.control.request({ ...h.event, senderFrame: { url: LOGIN } }, NONCE), null);
  assert.equal(h.control.request({ ...h.event, sender: new EventEmitter() }, NONCE), null);
  h.contents.mainFrame.url = LOGIN.replace('cas.univ-avignon.fr', 'services.univ-avignon.fr');
  assert.equal(h.control.request(h.event, NONCE), null);
  h.contents.mainFrame.url = LOGIN;
  h.block(); assert.equal(h.control.request(h.event, NONCE), null);
  assert(h.control.password); h.control.clear();
});
test('expired or cancelled credentials cannot be retrieved and old buffers are erased', () => {
  const h = harness(), password = h.control.password;
  h.expire(); assert.equal(h.control.request(h.event, NONCE), null);
  assert(password.every(byte => byte === 0));
  h.control.capture({ username: 'new', password: 'fake' });
  h.control.clear(); assert.equal(h.control.request(h.event, NONCE), null);
});
test('destroying the bound window releases the lease and unsupported forms fall back to manual entry', () => {
  const h = harness(), password = h.control.password;
  h.contents.emit('destroyed'); assert(!h.control.password); assert(password.every(byte => byte === 0));
  const other = harness();
  other.control.outcome(other.event, { status: 'UNSUPPORTED', nonce: NONCE });
  assert(!other.control.password); assert.deepEqual(other.outcomes, ['UNSUPPORTED']);
});
