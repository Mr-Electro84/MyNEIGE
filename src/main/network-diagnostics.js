'use strict';
const networkErrors = new Set(['ERR_FAILED', 'ERR_ABORTED', 'ERR_BLOCKED_BY_CLIENT', 'ERR_ACCESS_DENIED',
  'ERR_NETWORK_ACCESS_DENIED', 'ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_PROXY_AUTH_REQUESTED', 'ERR_PROXY_AUTH_UNSUPPORTED', 'ERR_NO_SUPPORTED_PROXIES',
  'ERR_INVALID_AUTH_CREDENTIALS', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_RESET', 'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_TIMED_OUT', 'ERR_TIMED_OUT', 'ERR_NAME_NOT_RESOLVED', 'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_COMMON_NAME_INVALID', 'ERR_CERT_DATE_INVALID', 'ERR_SSL_PROTOCOL_ERROR', 'ERR_EMPTY_RESPONSE',
  'ERR_HTTP2_PROTOCOL_ERROR', 'ERR_CONTENT_DECODING_FAILED', 'ERR_INSUFFICIENT_RESOURCES', 'ERR_CACHE_MISS']);
function networkError(value) {
  const code = typeof value === 'string' ? value.replace(/^net::/, '') : '';
  return networkErrors.has(code) ? code : 'OTHER';
}
function requestMetadata(details) {
  try {
    const url = new URL(details.url);
    if (!['https:', 'wss:'].includes(url.protocol) || url.hostname.length > 253 ||
        !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(url.hostname)) return null;
    const types = new Set(['mainFrame', 'subFrame', 'stylesheet', 'script', 'image', 'font', 'object', 'xhr',
      'ping', 'cspReport', 'media', 'webSocket', 'other']);
    return `${url.hostname} ${types.has(details.resourceType) ? details.resourceType : 'other'}`;
  } catch { return null; }
}
module.exports = { networkErrors, networkError, requestMetadata };
