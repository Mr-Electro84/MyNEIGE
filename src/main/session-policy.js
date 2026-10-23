'use strict';
const { allowedURL } = require('./policy');
function protectRequests(session, onDomain = () => {}) {
  const domains = new Set();
  session.webRequest.onBeforeRequest((details, callback) => {
    const allowed = allowedURL(details.url);
    if (allowed) {
      const host = new URL(details.url).hostname;
      if (!domains.has(host)) { domains.add(host); onDomain(host); }
    }
    callback({ cancel: !allowed });
  });
}
module.exports = { protectRequests };
