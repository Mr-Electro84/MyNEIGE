'use strict';
// Fixtures locales : ni YouTube, ni H5P, ni RENATER ne sont contactés.
const fs = require('node:fs');
const path = require('node:path');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
// Six images VP8 synthétiques 160x90, encodées avec Chromium (aucun média tiers).
const video = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZ0GTFUmpZqYq17GDD0JARImIQJLAAAAAAABNgIdNeU5FSUdFV0GHTXlORUlHRRZUrmubrpnXgQFzxYEBg4EBhoVWX1ZQOOCGsIGguoFaH0O2dUFC54EAo8qBAACAcAUAnQEqoABaAASHCIWFiJmEiBgCAAZYL1PnTp0dZs2bNmzZs2bNmzZs2bNmzZs2bNmzY8D+694v87VsfZ9/4Nkim2uMAKOtgQDIALEDABIRZAAYCdPJDFuUcAGqrABWACsAFYAKwAVgAqwA/tSP0KMJpI7Ao6yBAZAAcQMAEhE0ABgAGLf0DAADVVgArABWACsAFYAKwAVY/uQAibsO3J+iMKOugQJYAHEDABIRCAAYABi39AwAA1VYAKwAVgArABWACsAFWP7eEdpEIPri5shvAKOugQMgAHEDABIQ5AAYABi39AwAA1VYAKwAVgArABWACsAFWP7p7OrSaReb3LRQCKO0gQPoANEDABIQtAAYDNDJU1uUcAPgNWvhCrWC2FawFsK1gLYTAP7l+i5P0vf6+8odiXmUwA==', 'base64');
const html = text => new Response(`<!doctype html><meta charset="utf-8">${text}`, { headers: { 'content-type': 'text/html' } });
const player = 'https://www.youtube.com/embed/fixture';
function embeddedFixture(request) {
  const url = new URL(request.url);
  if (url.pathname === '/embed-fixture') {
    const kind = url.searchParams.get('kind');
    let source = player;
    if (kind === 'nocookie') source = 'https://www.youtube-nocookie.com/embed/fixture';
    if (kind === 'redirect') source = 'https://www.youtube.com/embed/redirect-fixture';
    if (kind === 'h5p') source = '/h5p-fixture';
    if (kind === 'cloud') source = 'https://avignon.h5p.com/content/123/embed';
    if (kind === 'srcdoc') return html(`<iframe srcdoc="&lt;iframe src='${player}'&gt;&lt;/iframe&gt;"></iframe>`);
    return html(`<iframe src="${source}" allow="autoplay; fullscreen" allowfullscreen></iframe>`);
  }
  if (url.pathname === '/h5p-fixture' || url.href === 'https://avignon.h5p.com/content/123/embed')
    return html(`<script src="https://www.youtube.com/iframe_api"></script><iframe src="${player}" allow="autoplay; fullscreen" allowfullscreen></iframe>`);
  if (url.pathname === '/iframe_api') return new Response('window.fixtureYoutubeApi = true;', { headers: { 'content-type': 'text/javascript' } });
  if (url.pathname === '/embed/redirect-fixture') return new Response(null, { status: 302, headers: { location: player } });
  if (url.pathname === '/embed/fixture') return html(`
    <script src="https://www.youtube.com/s/player/fixture/base.js"></script>
    <video muted autoplay controls crossorigin="anonymous" src="https://rr1---sn-fixture.googlevideo.com/videoplayback"></video>
    <script>window.fixtureApi = false;
      fetch('https://youtubei.googleapis.com/youtubei/v1/player').then(r => r.json()).then(v => { window.fixtureApi = v.fixture; });
    </script>`);
  if (url.href === 'https://www.youtube.com/s/player/fixture/base.js')
    return new Response('window.fixturePlayerScript = true;', { headers: { 'content-type': 'text/javascript' } });
  if (url.hostname === 'youtubei.googleapis.com') return new Response('{"fixture":true}',
    { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
  if (url.hostname === 'rr1---sn-fixture.googlevideo.com') {
    const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') || '');
    const first = match ? Number(match[1]) : 0, last = match?.[2] ? Math.min(Number(match[2]), video.length - 1) : video.length - 1;
    const headers = { 'content-type': 'video/webm', 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' };
    if (match) headers['content-range'] = `bytes ${first}-${last}/${video.length}`;
    return new Response(video.subarray(first, last + 1), { status: match ? 206 : 200, headers });
  }
  if (url.hostname === 'partage.univ-avignon.fr' && url.pathname === '/mail-fixture')
    return new Response(null, { status: 302, headers: { location: 'https://webmail.partage.renater.fr/mail-fixture' } });
  if (url.hostname === 'webmail.partage.renater.fr' && url.pathname === '/mail-fixture')
    return html('<script src="https://static.partage.renater.fr/mail-fixture.js"></script>');
  if (url.hostname === 'static.partage.renater.fr') return new Response('document.title = "RENATER fixture";',
    { headers: { 'content-type': 'text/javascript' } });
  if (url.pathname === '/mail-saml-fixture') {
    if (url.hostname === 'partage.univ-avignon.fr') return new Response(null, { status: 302,
      headers: { location: 'https://idp.univ-avignon.fr/mail-saml-fixture' } });
    if (url.hostname === 'idp.univ-avignon.fr') return html('<form method="POST" action="https://sp.partage.renater.fr/mail-saml-fixture"><input name="SAMLResponse" value="local-fixture"></form><script>document.forms[0].submit();</script>');
    if (url.hostname === 'sp.partage.renater.fr') return request.text().then(body => {
      if (request.method !== 'POST' || body !== 'SAMLResponse=local-fixture') throw new Error('Retour SAML fictif altéré');
      return new Response(null, { status: 302, headers: { location: 'https://partage.univ-avignon.fr/mail-saml-complete' } });
    });
  }
  if (url.hostname === 'partage.univ-avignon.fr' && url.pathname === '/mail-saml-complete') return html('<title>SAML fixture completed</title>');
  return null;
}
async function runEmbeddedTests({ window, directory }) {
  let checks = 0;
  const samples = [
    'https://cours.univ-avignon.fr/embed-fixture?kind=direct',
    'https://ent.univ-avignon.fr/embed-fixture?kind=nocookie',
    'https://cours.univ-avignon.fr/embed-fixture?kind=redirect',
    'https://e-uapv.univ-avignon.fr/embed-fixture?kind=h5p',
    'https://cours.univ-avignon.fr/embed-fixture?kind=cloud',
    'https://cours.univ-avignon.fr/embed-fixture?kind=srcdoc'
  ];
  for (const url of samples) {
    await window.loadURL(url);
    const deadline = Date.now() + 6000;
    let played = false;
    while (Date.now() < deadline) {
      const frame = window.webContents.mainFrame.framesInSubtree.find(frame => frame.url.includes('/embed/fixture'));
      if (frame) played = await frame.executeJavaScript(`(() => {
        const video = document.querySelector('video');
        return video?.readyState >= 2 && video.currentTime > 0 && video.videoWidth === 160 &&
          window.fixtureApi && window.fixturePlayerScript && typeof require === 'undefined' && typeof process === 'undefined';
      })()`);
      if (played) break;
      await pause(50);
    }
    if (!played) throw new Error(`Lecture synthétique iframe échouée : ${new URL(url).search}`);
    if (url.includes('kind=h5p') || url.includes('kind=cloud')) {
      const h5p = window.webContents.mainFrame.framesInSubtree.find(frame => frame.url.includes('/h5p-fixture') || frame.url.includes('/content/123/embed'));
      if (!h5p || !await h5p.executeJavaScript('window.fixtureYoutubeApi === true')) throw new Error('API YouTube H5P non chargée');
    }
    ++checks;
  }
  try { fs.writeFileSync(path.join(directory, 'embedded-video-preview.png'), (await window.webContents.capturePage()).toPNG()); } catch { /* Aperçu facultatif. */ }
  // Le lecteur reste une iframe : aucune navigation ni fenêtre YouTube dans MyNEIGE.
  const topURL = window.webContents.getURL();
  const frame = window.webContents.mainFrame.framesInSubtree.find(frame => frame.url.includes('/embed/fixture'));
  if (!await frame.executeJavaScript(`window.open('https://www.youtube.com/watch?v=fixture') === null`)) throw new Error('Pop-up YouTube admis');
  await window.webContents.executeJavaScript(`location.href = 'https://www.youtube.com/watch?v=fixture'; void 0`);
  await pause(100);
  if (window.webContents.getURL() !== topURL) throw new Error('Navigation principale YouTube admise'); ++checks;
  // Un CDN vidéo ne devient pas accessible depuis les scripts de la page du cours.
  const refused = await window.webContents.executeJavaScript(`fetch('https://rr1---sn-fixture.googlevideo.com/videoplayback').then(() => false, () => true)`);
  if (!refused) throw new Error('CDN vidéo accessible hors lecteur'); ++checks;
  await window.loadURL('https://partage.univ-avignon.fr/mail-fixture');
  if (window.webContents.getURL() !== 'https://webmail.partage.renater.fr/mail-fixture' ||
      await window.webContents.executeJavaScript('document.title') !== 'RENATER fixture') throw new Error('Redirection/ressources RENATER bloquées'); ++checks;
  await window.loadURL('https://partage.univ-avignon.fr/mail-saml-fixture').catch(error => {
    if (error.code !== 'ERR_ABORTED') throw error; // Navigation remplacée par le retour POST automatique.
  });
  const deadline = Date.now() + 5000;
  while (window.webContents.getURL() !== 'https://partage.univ-avignon.fr/mail-saml-complete' || window.webContents.isLoading()) {
    if (Date.now() >= deadline) throw new Error('Retour IdP vers PARTAGE incomplet');
    await pause(25);
  }
  if (await window.webContents.executeJavaScript('document.title') !== 'SAML fixture completed') throw new Error('Page finale SAML absente'); ++checks;
  return checks;
}
module.exports = { embeddedFixture, runEmbeddedTests };
