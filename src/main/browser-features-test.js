'use strict';
// Synthetic HTTPS fixtures only. No student file or account is inspected.
const fs = require('node:fs');
const path = require('node:path');
const { START_URL } = require('./policy');
const { createDownloads, safeFilename } = require('./downloads');
const { navigationFor } = require('./navigation');
const { protectRequests } = require('./session-policy');
const { APP_ICON } = require('./app-icon');
const { nativeImage } = require('electron');
const { embeddedFixture, runEmbeddedTests } = require('./embedded-content-test');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() >= deadline) throw new Error('Browser feature fixture timed out'); await pause(25); }
}
function pdfFixture() {
  const stream = 'BT /F1 24 Tf 50 750 Td (MyNEIGE PDF fixture) Tj ET\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}endstream`];
  let content = '%PDF-1.4\n';
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(content.length); content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = content.length;
  content += 'xref\n0 6\n0000000000 65535 f \n' + offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(content + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
async function expectPdf(window, url) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const viewer = window.webContents.mainFrame.framesInSubtree.find(frame =>
      frame.url === 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html');
    if (viewer && await viewer.executeJavaScript(`(() => {
      const viewer = document.querySelector('pdf-viewer');
      return viewer?.loadState_ === 'success' && viewer.originalUrl === ${JSON.stringify(url)} &&
        viewer.documentDimensions?.pageDimensions?.length === 1 &&
        typeof require === 'undefined' && typeof process === 'undefined';
    })()`)) return;
    await pause(50);
  }
  throw new Error('Inline PDF did not render its single page');
}
async function run({ session, protectedWindow, CasPrefill, directory }) {
  fs.mkdirSync(directory, { recursive: true });
  const browserSession = session.fromPartition(`features-${Date.now()}`, { cache: false });
  protectRequests(browserSession);
  const payload = pdfFixture();
  let slowStream, progressDialog = false, popupPosts = 0;
  browserSession.protocol.handle('https', async request => {
    const embedded = embeddedFixture(request);
    if (embedded) return embedded;
    const url = new URL(request.url);
    if (['/inline.pdf', '/inline-auto.pdf', '/inline-post.pdf'].includes(url.pathname)) {
      if (url.pathname === '/inline-post.pdf' && (request.method !== 'POST' || await request.text() !== 'fixture=local-only'))
        throw new Error('Inline PDF popup lost POST body');
      const headers = { 'content-type': 'application/pdf' };
      if (url.pathname !== '/inline-auto.pdf') headers['content-disposition'] = 'inline; filename="consultation.pdf"';
      return new Response(payload, { headers });
    }
    if (url.pathname === '/pdf-frame') return new Response('<!doctype html><iframe src="/inline.pdf"></iframe>',
      { headers: { 'content-type': 'text/html' } });
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
  let vpnReady = true;
  const window = protectedWindow(browserSession, prefiller, downloads, () => vpnReady);
  let checks = 0;
  try {
    if (nativeImage.createFromPath(APP_ICON).isEmpty()) throw new Error('Application icon missing or unreadable'); ++checks;
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
    // Keep expected addresses independent of the menu implementation.
    const services = [
      ['university-ent', 'https://ent.univ-avignon.fr/'],
      ['university-directory', 'https://annuaire.univ-avignon.fr/'],
      ['university-projects', 'https://projets.univ-avignon.fr/'],
      ['university-moodle', 'https://e-uapv.univ-avignon.fr/'],
      ['university-timetable', 'https://edt.univ-avignon.fr/'],
      ['university-mail', 'https://partage.univ-avignon.fr/'],
      ['university-nextcloud', 'https://cloud.univ-avignon.fr/']
    ];
    const primaryContents = window.webContents, windowCount = windows.size;
    for (const [id, url] of services) {
      const item = navigation.menu.getMenuItemById(id);
      if (!item?.enabled) throw new Error('University menu item missing or disabled');
      item.click();
      await until(() => window.webContents.getURL() === url && !window.webContents.isLoading());
      if (windows.size !== windowCount || window.webContents !== primaryContents || window.webContents.session !== browserSession)
        throw new Error('University menu replaced the window or session'); ++checks;
    }
    navigation.menu.getMenuItemById('back').click();
    await until(() => window.webContents.getURL() === services.at(-2)[1] && !window.webContents.isLoading()); ++checks;
    vpnReady = false; navigation.refresh();
    for (const [id] of services) {
      const item = navigation.menu.getMenuItemById(id);
      if (item.enabled) throw new Error('University menu enabled without VPN');
      item.click(); // Also exercise the readiness guard against an already queued click.
    }
    await pause(100);
    if (window.webContents.getURL() !== services.at(-2)[1]) throw new Error('University menu navigated without VPN'); ++checks;
    vpnReady = true; navigation.refresh();
    navigation.menu.getMenuItemById('home').click();
    await until(() => window.webContents.getURL() === START_URL && !window.webContents.isLoading());
    if (window.webContents.session !== browserSession) throw new Error('Navigation changed session');
    const inline = 'https://www.appigs.univ-avignon.fr/inline.pdf';
    await window.loadURL(inline); await expectPdf(window, inline);
    // Rendering state/page count above are mandatory; a hidden compositor may
    // refuse an optional screenshot in the native WFP preflight.
    try { fs.writeFileSync(path.join(directory, 'inline-pdf-preview.png'), (await window.webContents.capturePage()).toPNG()); } catch { /* Optional preview. */ }
    ++checks;
    const automaticInline = 'https://www.appigs.univ-avignon.fr/inline-auto.pdf';
    await window.loadURL(automaticInline); await expectPdf(window, automaticInline); ++checks;
    await window.loadURL('https://www.appigs.univ-avignon.fr/pdf-frame'); await expectPdf(window, inline); ++checks;
    await window.loadURL(one);
    await window.webContents.executeJavaScript(`(() => {
      const form = document.createElement('form'); form.method = 'POST'; form.target = '_blank';
      form.action = 'https://www.appigs.univ-avignon.fr/inline-post.pdf';
      const input = document.createElement('input'); input.name = 'fixture'; input.value = 'local-only';
      form.append(input); document.body.append(form); form.submit(); form.remove();
    })()`);
    const popupPdf = 'https://www.appigs.univ-avignon.fr/inline-post.pdf';
    await until(() => [...windows].some(child => !child.isDestroyed() && child.webContents.getURL() === popupPdf));
    const pdfWindow = [...windows].find(child => !child.isDestroyed() && child.webContents.getURL() === popupPdf);
    await expectPdf(pdfWindow, popupPdf);
    if (pdfWindow.webContents.session !== browserSession || downloads.records().length) throw new Error('Inline PDF changed session or started a download');
    pdfWindow.destroy(); ++checks;
    checks += await runEmbeddedTests({ window, directory });
    await window.loadURL(one);
    // Real renderer navigation must not acquire a blanket internal-page exception.
    const deniedNavigation = [];
    const observe = (event, url) => { if (event.defaultPrevented) deniedNavigation.push(typeof url === 'string' ? url : event.url); };
    window.webContents.on('will-frame-navigate', observe);
    for (const url of ['chrome://settings/', 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html', 'https://evil.test/']) {
      await window.webContents.executeJavaScript(`location.href = ${JSON.stringify(url)}; void 0`);
      // Chromium itself rejects web-page access to some internal schemes
      // before emitting navigation events; HTTPS must reach our own guard.
      if (url.startsWith('https:')) await until(() => deniedNavigation.includes(url));
      else await pause(100);
      if (window.webContents.getURL() !== one) throw new Error('Out-of-policy navigation accepted');
    }
    window.webContents.removeListener('will-frame-navigate', observe);
    ++checks;
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
    const popupURL = named.webContents.getURL(), countBeforeMenu = windows.size;
    navigationFor(named).menu.getMenuItemById('university-ent').click();
    await until(() => window.webContents.getURL() === services[0][1] && !window.webContents.isLoading());
    if (named.webContents.getURL() !== popupURL || windows.size !== countBeforeMenu)
      throw new Error('Popup university menu did not target the initial APPIGS window'); ++checks;
    const before = windows.size;
    const refused = await window.webContents.executeJavaScript(`['https://example.com', 'file:///C:/Windows/win.ini', 'data:text/html,fixture'].every(url => window.open(url) === null)`);
    if (!refused || windows.size !== before) throw new Error('Out-of-policy popup accepted'); ++checks;
    window.webContents.downloadURL('https://www.appigs.univ-avignon.fr/slow.bin');
    await until(() => downloads.records().some(record => record.name === 'interruption-pilote.bin'));
    downloads.stop();
    await until(() => downloads.records().some(record => record.name === 'interruption-pilote.bin' && record.state === 'cancelled')); ++checks;
    window.destroy();
    for (const [id] of services) {
      const item = navigationFor(named).menu.getMenuItemById(id);
      if (item.enabled) throw new Error('University menu enabled after initial window closed');
      item.click();
    }
    if (named.webContents.getURL() !== popupURL) throw new Error('University menu navigated a popup after initial window closed'); ++checks;
    return checks;
  } finally {
    downloads.dispose(); prefiller.clear(); for (const child of windows) if (!child.isDestroyed()) child.destroy();
    try { slowStream?.close(); } catch { /* Cancelled stream may already be closed. */ }
    browserSession.protocol.unhandle('https');
    await browserSession.clearStorageData();
  }
}
module.exports = { run };
