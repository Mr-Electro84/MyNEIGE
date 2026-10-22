'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { START_URL, allowedURL, validateCredentials } = require('../src/main/policy');
test('university HTTPS and WSS are admitted', () => {
  for (const url of [START_URL, 'https://univ-avignon.fr/', 'https://cas.univ-avignon.fr/cas/login?service=test', 'wss://ent.univ-avignon.fr/socket']) assert(allowedURL(url));
});
test('lookalike domains and URL user-info cannot escape the allowlist', () => {
  for (const url of ['https://univ-avignon.fr.evil.test/', 'https://eviluniv-avignon.fr/', 'https://univ-avignon.fr@evil.test/', 'https://a@cas.univ-avignon.fr/', 'https://evil.test/?https://cas.univ-avignon.fr/', 'https://cas.univ-avignon.fr./']) assert(!allowedURL(url), url);
});
test('local control addresses, extra ports and unsafe schemes are refused', () => {
  for (const url of ['http://cas.univ-avignon.fr/', 'https://127.0.0.1/', 'https://[::1]/', 'https://cas.univ-avignon.fr:444/', 'file:///C:/Windows/win.ini', 'javascript:alert(1)', 'ftp://cas.univ-avignon.fr/', 'not a URL']) assert(!allowedURL(url), url);
});
test('VPN credential frame rejects injection, oversize and unknown properties', () => {
  assert(validateCredentials({ username: 'élève', password: 'a"b\\c' }));
  for (const value of [null, {}, { username: '', password: 'x' }, { username: 'x', password: 'x\nsignal SIGTERM' },
    { username: 'x\0', password: 'x' }, { username: 'x', password: 'é'.repeat(2049) },
    { username: 'x', password: 'x', command: 'connect' }, { username: 1, password: 'x' }]) assert(!validateCredentials(value));
});
