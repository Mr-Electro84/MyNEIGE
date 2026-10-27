'use strict';
const START_URL = 'https://www.appigs.univ-avignon.fr/extranet/etu_suivi.html';
function universityHost(host) {
  return typeof host === 'string' && (host === 'univ-avignon.fr' || host.endsWith('.univ-avignon.fr'));
}
function domainHost(host, domain) {
  return typeof host === 'string' && (host === domain || host.endsWith(`.${domain}`));
}
function allowedURL(value) {
  try {
    const url = new URL(value);
    return ['https:', 'wss:'].includes(url.protocol) && (universityHost(url.hostname) || domainHost(url.hostname, 'renater.fr')) &&
      !url.username && !url.password && (!url.port || url.port === '443');
  } catch { return false; }
}
function externalURL(value) {
  try {
    if (typeof value !== 'string' || /[\x00-\x20\x7f]/u.test(value)) return null;
    const url = new URL(value);
    // Un domaine interne refusé (HTTP, port, point final…) ne doit jamais
    // devenir un repli hors de la session protégée.
    const host = url.hostname.replace(/\.+$/u, '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        universityHost(host) || domainHost(host, 'renater.fr') || url.href.length > 2081) return null;
    return url.href;
  } catch { return null; }
}
function validateCredentials(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'password,username') return false;
  return ['username', 'password'].every(key => typeof value[key] === 'string' &&
    value[key].length > 0 && Buffer.byteLength(value[key], 'utf8') <= 4096 && !/[\x00-\x1f\x7f]/u.test(value[key]));
}
module.exports = { START_URL, universityHost, domainHost, allowedURL, externalURL, validateCredentials };
