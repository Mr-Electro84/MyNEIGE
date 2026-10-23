'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pdfRequestAllowed, pdfNavigationAllowed } = require('../src/main/pdf-policy');
const { protectRequests } = require('../src/main/session-policy');
const { allowedURL } = require('../src/main/policy');
const ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai';
const INDEX = `${ORIGIN}/index.html`;
const STREAM = `${ORIGIN}/12345678-1234-1234-1234-123456789abc`;
const PAGE = 'https://www.appigs.univ-avignon.fr/document.pdf';
function fixture() {
  const top = { url: PAGE }; top.top = top;
  const viewer = { url: INDEX, parent: top, top };
  const child = { url: '', parent: viewer, top };
  const contents = { mainFrame: top, isDestroyed: () => false };
  return { top, viewer, child, contents,
    index: { url: INDEX, resourceType: 'subFrame', frame: { url: 'about:blank', parent: top, top }, webContents: contents },
    script: { url: 'chrome://resources/js/assert.js', resourceType: 'script', frame: viewer, initiatorOrigin: ORIGIN, webContents: contents },
    navigation: { url: STREAM, isMainFrame: false, frame: child, initiator: viewer } };
}
test('PDF component loads only in a university child frame with its own resources', () => {
  const f = fixture();
  assert(pdfRequestAllowed(f.index)); assert(pdfRequestAllowed(f.script));
  assert(pdfRequestAllowed({ ...f.script, url: `${ORIGIN}/main.js` }));
  assert(pdfRequestAllowed({ ...f.script, url: `${ORIGIN}/index.css`, resourceType: 'stylesheet' }));
  assert(pdfNavigationAllowed(f.navigation));
  assert(!allowedURL(INDEX)); assert(!allowedURL(STREAM)); // Network policy stays strict.
});
test('university pages cannot fetch internal scripts or navigate to internal pages', () => {
  const f = fixture();
  for (const change of [{ frame: f.top }, { initiatorOrigin: 'https://www.appigs.univ-avignon.fr' },
    { frame: null }, { webContents: undefined }, { resourceType: 'xhr' },
    { webContents: { mainFrame: {}, isDestroyed: () => false } },
    { webContents: { mainFrame: f.top, isDestroyed: () => true } }])
    assert(!pdfRequestAllowed({ ...f.script, ...change }));
  for (const change of [{ resourceType: 'mainFrame' }, { frame: f.top },
    { frame: { url: PAGE, parent: f.top, top: f.top } }]) assert(!pdfRequestAllowed({ ...f.index, ...change }));
  for (const change of [{ isMainFrame: true }, { initiator: f.top }, { initiator: undefined },
    { frame: { parent: f.top } }, { url: INDEX }, { url: `${STREAM}?other=1` }])
    assert(!pdfNavigationAllowed({ ...f.navigation, ...change }));
});
test('viewer exceptions reject other extensions, Chrome pages and external requests', () => {
  const f = fixture();
  for (const url of ['chrome://settings/', 'chrome://resources/js/other.js', `${ORIGIN}/unknown.js`,
    `${ORIGIN}/main.js?extra=1`, `${ORIGIN}.evil.test/main.js`, 'chrome-extension://other/main.js',
    'https://evil.test/file.pdf', 'file:///C:/secret', 'data:text/plain,secret', 'blob:null/id']) {
    assert(!pdfRequestAllowed({ ...f.script, url }), url);
    assert(!pdfNavigationAllowed({ ...f.navigation, url }), url);
  }
  for (const url of ['https://evil.test/', 'about:blank', 'http://www.appigs.univ-avignon.fr/']) {
    f.top.url = url;
    assert(!pdfRequestAllowed(f.index)); assert(!pdfRequestAllowed(f.script)); assert(!pdfNavigationAllowed(f.navigation));
  }
  Object.defineProperty(f.viewer, 'url', { get() { throw new Error('Frame destroyed'); } });
  assert(!pdfRequestAllowed(f.script)); assert(!pdfNavigationAllowed(f.navigation));
});
test('request filter allows internal PDF resources without logging them as network domains', () => {
  let listener;
  const domains = [];
  protectRequests({ webRequest: { onBeforeRequest(callback) { listener = callback; } } }, host => domains.push(host));
  const check = details => { let result; listener(details, value => { result = value; }); return result.cancel; };
  const f = fixture();
  assert(!check({ url: PAGE })); assert(!check(f.index)); assert(!check(f.script));
  assert(check({ ...f.script, url: 'https://evil.test/' }));
  assert.deepEqual(domains, ['www.appigs.univ-avignon.fr']);
});
