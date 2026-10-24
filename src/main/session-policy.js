'use strict';
const { allowedURL } = require('./policy');
const { pdfRequestAllowed } = require('./pdf-policy');
const { embeddedRequestAllowed } = require('./embedded-content-policy');
const { requestMetadata } = require('./network-diagnostics');
function protectRequests(session, onDomain = () => {}, onBlocked = () => {}) {
  const domains = new Set();
  const blocked = new Set();
  session.webRequest.onBeforeRequest((details, callback) => {
    const university = allowedURL(details.url);
    const embedded = !university && embeddedRequestAllowed(details);
    const allowed = university || embedded || pdfRequestAllowed(details);
    if (university || (embedded && details.url.startsWith('https:'))) {
      const host = new URL(details.url).hostname;
      if (!domains.has(host)) { domains.add(host); onDomain(host); }
    }
    if (!allowed && blocked.size < 64) {
      const metadata = requestMetadata(details);
      if (metadata && !blocked.has(metadata)) { blocked.add(metadata); onBlocked(metadata); }
    }
    callback({ cancel: !allowed });
  });
}
module.exports = { protectRequests };
