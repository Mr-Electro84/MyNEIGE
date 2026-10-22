'use strict';
const START_URL = 'https://www.appigs.univ-avignon.fr/extranet/etu_suivi.html';
function universityHost(host) {
  return typeof host === 'string' && (host === 'univ-avignon.fr' || host.endsWith('.univ-avignon.fr'));
}
function allowedURL(value) {
  try {
    const url = new URL(value);
    return ['https:', 'wss:'].includes(url.protocol) && universityHost(url.hostname) &&
      !url.username && !url.password && (!url.port || url.port === '443');
  } catch { return false; }
}
function validateCredentials(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'password,username') return false;
  return ['username', 'password'].every(key => typeof value[key] === 'string' &&
    value[key].length > 0 && Buffer.byteLength(value[key], 'utf8') <= 4096 && !/[\x00-\x1f\x7f]/u.test(value[key]));
}
module.exports = { START_URL, universityHost, allowedURL, validateCredentials };
