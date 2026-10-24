'use strict';
const { allowedURL } = require('./policy');
const { pdfRequestAllowed } = require('./pdf-policy');
const { embeddedRequestAllowed } = require('./embedded-content-policy');
function protectRequests(session, onDomain = () => {}) {
  const domains = new Set();
  session.webRequest.onBeforeRequest((details, callback) => {
    const university = allowedURL(details.url);
    const embedded = !university && embeddedRequestAllowed(details);
    const allowed = university || embedded || pdfRequestAllowed(details);
    if (university || (embedded && details.url.startsWith('https:'))) {
      const host = new URL(details.url).hostname;
      if (!domains.has(host)) { domains.add(host); onDomain(host); }
    }
    callback({ cancel: !allowed });
  });
}
module.exports = { protectRequests };
