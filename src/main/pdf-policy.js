'use strict';
const { allowedURL } = require('./policy');

// Chromium's built-in PDF component only. These local resources never go to
// the proxy; do not add these schemes to the university network allowlist.
const PDF_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai';
const PDF_INDEX = `${PDF_ORIGIN}/index.html`;
const pdfStream = /^chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const resources = new Map([
  [`${PDF_ORIGIN}/index.css`, 'stylesheet'],
  ...['main.js', 'pdf_viewer_wrapper.js', 'browser_api.js', 'shared.rollup.js', 'pdf_scripting_api.js']
    .map(name => [`${PDF_ORIGIN}/${name}`, 'script']),
  ['chrome://resources/css/text_defaults_md.css', 'stylesheet'],
  ...['lit/v3_0/lit.rollup.js', 'js/load_time_data.js', 'js/assert.js', 'mojo/mojo/public/js/bindings.js']
    .map(name => [`chrome://resources/${name}`, 'script'])
]);
function universityDocument(frame) {
  return Boolean(frame && frame.url.startsWith('https:') && allowedURL(frame.url));
}
function viewerFrame(frame) {
  return Boolean(frame && frame.url === PDF_INDEX && universityDocument(frame.parent) && universityDocument(frame.top));
}
function pdfRequestAllowed(details) {
  try {
    const frame = details.frame;
    if (!frame || !details.webContents || details.webContents.isDestroyed() ||
        frame.top !== details.webContents.mainFrame || !universityDocument(frame.top)) return false;
    // Chromium creates an empty child frame before requesting the viewer.
    if (details.url === PDF_INDEX && details.resourceType === 'subFrame') {
      return ['', 'about:blank'].includes(frame.url) && universityDocument(frame.parent);
    }
    return viewerFrame(frame) && details.initiatorOrigin === PDF_ORIGIN &&
      resources.has(details.url) && resources.get(details.url) === details.resourceType;
  } catch { return false; } // Destroyed or missing frame: fail closed.
}
function pdfNavigationAllowed(details) {
  try {
    // Only the viewer may navigate its own child to a generated PDF stream.
    // Top-level navigation, redirects and arbitrary extension pages stay denied.
    return details.isMainFrame === false &&
      pdfStream.test(details.url) &&
      viewerFrame(details.frame?.parent) && details.initiator === details.frame.parent;
  } catch { return false; }
}
module.exports = { pdfRequestAllowed, pdfNavigationAllowed };
