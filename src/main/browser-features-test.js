'use strict';
// Synthetic HTTPS fixtures only. No student file or account is inspected.
const fs = require('node:fs');
const path = require('node:path');
const { START_URL } = require('./policy');
const { createDownloads, safeFilename } = require('./downloads');
const { navigationFor } = require('./navigation');
const { protectRequests } = require('./session-policy');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() >= deadline) throw new Error('Browser feature fixture timed out'); await pause(25); }
}
async function run({ session, protectedWindow, CasPrefill, directory }) {
  fs.mkdirSync(directory, { recursive: true });
  const browserSession = session.fromPartition(`features-${Date.now()}`, { cache: false });
  protectRequests(browserSession);
  const payload = Buffer.from('%PDF-1.4\nMyNEIGE fixture, not a student document.\n%%EOF\n');
  let slowStream, progressDialog = false, popupPosts = 0;
  browserSession.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (['/popup-post.pdf', '/popup-blank.pdf', '/popup-named.pdf'].includes(url.pathname)) {
      if (request.method !== 'POST' || await request.text() !== 'fixture=local-only') throw new Error('Popup lost the fixture POST body');
      ++popupPosts;
      return new Response(payload, { headers: { 'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${url.pathname.slice(1)}"` } });
    }
    if (url.pathname === '/fixture.pdf') {
      return new Response(payload, { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="preuve-pilote.pdf"' } });
    }
    if (url.pathname === '/slow.bin') {
      return new Response(new ReadableStream({ start(controller) { slowStream = controller; controller.enqueue(new Uint8Array(65536)); } }),
        { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="interruption-pilote.bin"' } });
    }
    return new Response('<!doctype html><meta charset="utf-8"><title>Pilote local</title><p>Page fictive</p>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
  await browserSession.cookies.set({ url: 'https://www.appigs.univ-avignon.fr', name: 'fixture-auth', value: 'local-only', secure: true });
  const downloads = createDownloads({ session: browserSession, ready: () => true, directory,
    dialog: { showMessageBox: async (_window, options) => { progressDialog = options.detail.includes('preuve-pilote.pdf'); return { response: 0 }; } } });
  const windows = new Set(), track = downloads.track;
  downloads.track = window => { track(window); windows.add(window); };
  // Tests choose a workspace path instead of showing the normal Save As dialog.
  browserSession.on('will-download', (_event, item) => item.setSavePath(path.join(directory, safeFilename(item.getFilename()))));
  const prefiller = new CasPrefill({ ready: () => true });
  const window = protectedWindow(browserSession, prefiller, downloads);
  let checks = 0;
  try {
    const one = 'https://www.appigs.univ-avignon.fr/one', two = 'https://www.appigs.univ-avignon.fr/two';
    await window.loadURL(one);
    const navigation = navigationFor(window);
    if (navigation.menu.getMenuItemById('back').enabled) throw new Error('Unexpected initial back entry');
    await window.loadURL(two);
    navigation.menu.getMenuItemById('back').click();
    await until(() => window.webContents.getURL() === one && !window.webContents.isLoading()); ++checks;
    navigation.menu.getMenuItemById('forward').click();
    await until(() => window.webContents.getURL() === two && !window.webContents.isLoading()); ++checks;
    navigation.menu.getMenuItemById('home').click();
    await until(() => window.webContents.getURL() === START_URL && !window.webContents.isLoading()); ++checks;
    if (window.webContents.session !== browserSession) throw new Error('Navigation changed session');
    await window.webContents.executeJavaScript(`(() => {
      const a = document.createElement('a'); a.href = 'https://www.appigs.univ-avignon.fr/fixture.pdf';
      a.download = 'preuve-pilote.pdf'; document.body.append(a); a.click(); a.remove();
    })()`);
    await until(() => downloads.records().some(record => record.state === 'completed'));
    if (!fs.readFileSync(path.join(directory, 'preuve-pilote.pdf')).equals(payload)) throw new Error('Downloaded fixture content differs');
    const cookies = await browserSession.cookies.get({ url: 'https://www.appigs.univ-avignon.fr', name: 'fixture-auth' });
    if (cookies.length !== 1 || cookies[0].value !== 'local-only') throw new Error('Download changed the session cookie jar'); ++checks;
    await downloads.show(window); if (!progressDialog) throw new Error('Download status missing'); ++checks;
    // Exercise a real blob download initiated by an anchor in the same renderer.
    await window.webContents.executeJavaScript(`(() => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['local blob fixture'], { type: 'text/plain' }));
      a.download = 'blob-pilote.txt'; document.body.append(a); a.click(); a.remove();
    })()`);
    await until(() => downloads.records().some(record => record.name === 'blob-pilote.txt' && record.state === 'completed'));
    if (fs.readFileSync(path.join(directory, 'blob-pilote.txt'), 'utf8') !== 'local blob fixture') throw new Error('Blob fixture differs'); ++checks;
    // A real form target=_blank must retain its POST body, not become a GET.
    await window.webContents.executeJavaScript(`(() => {
      const form = document.createElement('form'); form.method = 'POST'; form.target = '_blank';
      form.action = 'https://www.appigs.univ-avignon.fr/popup-post.pdf';
      const input = document.createElement('input'); input.name = 'fixture'; input.value = 'local-only';
      form.append(input); document.body.append(form); form.submit(); form.remove();
    })()`);
    await until(() => downloads.records().some(record => record.name === 'popup-post.pdf' && record.state === 'completed'));
    if (popupPosts !== 1 || !fs.readFileSync(path.join(directory, 'popup-post.pdf')).equals(payload)) throw new Error('POST popup fixture differs'); ++checks;
    // Script-created empty popups need a usable WindowProxy, inherited origin
    // and opener so the site can write its form and submit it afterwards.
    const blank = await window.webContents.executeJavaScript(`(() => {
      const child = window.open('about:blank', 'fixture-blank'); if (!child) return false;
      child.document.write('<!doctype html><title>Popup fictif</title><form method="POST" action="https://www.appigs.univ-avignon.fr/popup-blank.pdf"><input name="fixture" value="local-only"></form>');
      child.document.close();
      const valid = child.opener === window;
      child.document.forms[0].submit(); return valid;
    })()`);
    if (!blank) throw new Error('Empty popup has no usable opener');
    await until(() => downloads.records().some(record => record.name === 'popup-blank.pdf' && record.state === 'completed'));
    if (popupPosts !== 2 || !fs.readFileSync(path.join(directory, 'popup-blank.pdf')).equals(payload)) throw new Error('Empty popup POST fixture differs'); ++checks;
    // Reuse a named popup, as export interfaces often do.
    const usable = await window.webContents.executeJavaScript(`!!window.open('https://www.appigs.univ-avignon.fr/popup-page', 'fixture-named')`);
    if (!usable) throw new Error('Named popup has no WindowProxy');
    await until(() => [...windows].some(child => !child.isDestroyed() && child.webContents.getURL().endsWith('/popup-page') && !child.webContents.isLoading()));
    const named = [...windows].find(child => !child.isDestroyed() && child.webContents.getURL().endsWith('/popup-page'));
    if (named.webContents.session !== browserSession || !navigationFor(named) ||
        !await named.webContents.executeJavaScript(`typeof require === 'undefined' && typeof process === 'undefined' && typeof window.myneige === 'undefined' && !!window.opener`)) throw new Error('Popup lost its protection or opener'); ++checks;
    await window.webContents.executeJavaScript(`(() => {
      const form = document.createElement('form'); form.method = 'POST'; form.target = 'fixture-named';
      form.action = 'https://www.appigs.univ-avignon.fr/popup-named.pdf';
      const input = document.createElement('input'); input.name = 'fixture'; input.value = 'local-only';
      form.append(input); document.body.append(form); form.submit(); form.remove();
    })()`);
    await until(() => downloads.records().some(record => record.name === 'popup-named.pdf' && record.state === 'completed'));
    if (popupPosts !== 3) throw new Error('Named popup lost POST'); ++checks;
    const before = windows.size;
    const refused = await window.webContents.executeJavaScript(`['https://example.com', 'file:///C:/Windows/win.ini', 'data:text/html,fixture'].every(url => window.open(url) === null)`);
    if (!refused || windows.size !== before) throw new Error('Out-of-policy popup accepted'); ++checks;
    window.webContents.downloadURL('https://www.appigs.univ-avignon.fr/slow.bin');
    await until(() => downloads.records().some(record => record.name === 'interruption-pilote.bin'));
    downloads.stop();
    await until(() => downloads.records().some(record => record.name === 'interruption-pilote.bin' && record.state === 'cancelled')); ++checks;
    return checks;
  } finally {
    downloads.dispose(); prefiller.clear(); for (const child of windows) if (!child.isDestroyed()) child.destroy();
    try { slowStream?.close(); } catch { /* Cancelled stream may already be closed. */ }
    browserSession.protocol.unhandle('https');
    await browserSession.clearStorageData();
  }
}
module.exports = { run };
