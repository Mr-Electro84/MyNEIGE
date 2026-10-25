'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { networkError, requestMetadata } = require('../src/main/network-diagnostics');
const { protectRequests } = require('../src/main/session-policy');
test('les erreurs Chromium avec préfixe net:: conservent leur code utile', () => {
  assert.equal(networkError('net::ERR_TUNNEL_CONNECTION_FAILED'), 'ERR_TUNNEL_CONNECTION_FAILED');
  assert.equal(networkError('ERR_BLOCKED_BY_CLIENT'), 'ERR_BLOCKED_BY_CLIENT');
  assert.equal(networkError('net::ERR_HTTP2_PROTOCOL_ERROR'), 'ERR_HTTP2_PROTOCOL_ERROR');
  assert.equal(networkError('server-secret-token'), 'OTHER');
  assert.equal(networkError(undefined), 'OTHER');
});
test('les diagnostics ne contiennent ni URL complète, ni identifiants, ni paramètres', () => {
  assert.equal(requestMetadata({ url: 'https://user:secret@partage.univ-avignon.fr/private?ticket=secret#secret', resourceType: 'subFrame' }),
    'partage.univ-avignon.fr subFrame');
  assert.equal(requestMetadata({ url: 'https://www.youtube.com/embed/private?token=secret', resourceType: 'secret\nvalue' }),
    'www.youtube.com other');
  for (const url of ['data:text/plain,secret', 'file:///C:/secret', 'blob:https://www.youtube.com/secret', 'invalid'])
    assert.equal(requestMetadata({ url }), null);
});
test('les refus sont dédupliqués et bornés sans modifier la politique', () => {
  let listener;
  const records = [];
  protectRequests({ webRequest: { onBeforeRequest(callback) { listener = callback; }, onHeadersReceived() {} } }, () => {}, value => records.push(value));
  const check = url => { let response; listener({ url, resourceType: 'script' }, value => { response = value; }); return response.cancel; };
  assert(check('https://evil.test/private?secret=1'));
  assert(check('https://evil.test/other?secret=2'));
  assert.deepEqual(records, ['evil.test script']);
  for (let i = 0; i < 100; ++i) assert(check(`https://host${i}.test/`));
  assert.equal(records.length, 64);
  assert(!check('https://partage.univ-avignon.fr/'));
});
