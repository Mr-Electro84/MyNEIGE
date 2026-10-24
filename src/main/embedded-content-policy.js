'use strict';
const { universityHost, domainHost } = require('./policy');

const youtubePlayers = new Set(['youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
// Ces hôtes sont aussi admis par browserHost dans le relais natif. Aucun
// domaine Google générique n'est autorisé : uniquement les dépendances vidéo.
const youtubeHosts = new Set(['youtubei.googleapis.com', 'youtube.googleapis.com', 'jnn-pa.googleapis.com',
  'yt3.ggpht.com', 'www.gstatic.com', 'fonts.gstatic.com']);
function webURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') ? url : null;
  } catch { return null; }
}
function universityPage(value) {
  const url = webURL(value);
  return Boolean(url && universityHost(url.hostname));
}
function youtubeEmbed(value) {
  const url = webURL(value);
  return Boolean(url && youtubePlayers.has(url.hostname) && /^\/embed\/[^/]+\/?$/.test(url.pathname));
}
function h5pEmbed(value) {
  const url = webURL(value);
  return Boolean(url && ((domainHost(url.hostname, 'h5p.com') && /^\/content\/[^/]+\/embed\/?$/.test(url.pathname)) ||
    (domainHost(url.hostname, 'h5p.org') && /^\/h5p\/embed\/\d+\/?$/.test(url.pathname))));
}
function courseContext(frame) {
  if (!frame || !universityPage(frame.top?.url)) return null;
  let youtube = false, h5p = false;
  const visited = new Set();
  for (let current = frame; current; current = current.parent) {
    if (visited.has(current)) return null;
    visited.add(current);
    if (youtubeEmbed(current.url)) youtube = true;
    else if (h5pEmbed(current.url)) h5p = true;
    else if (!universityPage(current.url) && !['', 'about:blank', 'about:srcdoc'].includes(current.url)) return null;
    if (current === frame.top) return { youtube, h5p };
  }
  return null;
}
function embeddedNavigationAllowed(details) {
  try {
    return details.isMainFrame === false && Boolean(courseContext(details.frame?.parent)) &&
      (youtubeEmbed(details.url) || h5pEmbed(details.url));
  } catch { return false; }
}
function embeddedRequestAllowed(details) {
  try {
    const frame = details.frame;
    if (!frame || !details.webContents || details.webContents.isDestroyed() ||
        frame.top !== details.webContents.mainFrame || details.resourceType === 'mainFrame') return false;
    if (details.resourceType === 'subFrame') {
      return Boolean(courseContext(frame.parent)) && (youtubeEmbed(details.url) || h5pEmbed(details.url));
    }
    const context = courseContext(frame);
    if (!context) return false;
    // MediaSource crée des URL locales : aucune connexion hors proxy.
    if (details.resourceType === 'media' && details.url.startsWith('blob:') && context.youtube) {
      return new URL(details.url).origin === new URL(frame.url).origin && youtubeEmbed(frame.url);
    }
    const url = webURL(details.url);
    if (!url) return false;
    const host = url.hostname;
    // Bibliothèques des activités, parfois chargées par la page universitaire
    // avant la création de l'iframe H5P. La sortie réseau est publique et ciblée.
    if (['script', 'stylesheet'].includes(details.resourceType) &&
        ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'].includes(host)) return true;
    // H5P charge l'API YouTube depuis la page du cours, avant de créer l'iframe.
    if (details.resourceType === 'script' && youtubePlayers.has(host) &&
        (['/iframe_api', '/player_api'].includes(url.pathname) || url.pathname.startsWith('/s/player/'))) return true;
    if (details.resourceType === 'image' && domainHost(host, 'ytimg.com')) return true;
    if (details.resourceType === 'script' && (domainHost(host, 'h5p.com') || domainHost(host, 'h5p.org')) &&
        url.pathname.endsWith('/h5p-resizer.js')) return true;
    if (context.youtube && (domainHost(host, 'youtube.com') || domainHost(host, 'youtube-nocookie.com') ||
        domainHost(host, 'googlevideo.com') || domainHost(host, 'ytimg.com') || youtubeHosts.has(host))) return true;
    if (context.youtube && host === 'www.google.com' && url.pathname.startsWith('/js/')) return true;
    if (context.h5p && (domainHost(host, 'h5p.com') || domainHost(host, 'h5p.org') || domainHost(host, 'h5p.io') ||
        host === 'cdnjs.cloudflare.com' || host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com')) return true;
    return false;
  } catch { return false; } // Une frame détruite ou sans provenance est refusée.
}
module.exports = { embeddedRequestAllowed, embeddedNavigationAllowed };
