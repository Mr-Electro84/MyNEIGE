'use strict';
const { allowedURL } = require('./policy');
const { pdfRequestAllowed } = require('./pdf-policy');
function protectRequests(session, onDomain = () => {}) {
  const domains = new Set();
  session.webRequest.onBeforeRequest((details, callback) => {
    const university = allowedURL(details.url);
    const allowed = university || pdfRequestAllowed(details);
    if (university) {
      const host = new URL(details.url).hostname;
      if (!domains.has(host)) { domains.add(host); onDomain(host); }
    }
    callback({ cancel: !allowed });
  });
}
module.exports = { protectRequests };
