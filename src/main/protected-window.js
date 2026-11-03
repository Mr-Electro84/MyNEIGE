'use strict';
const path = require('node:path');
const { allowedURL, externalURL } = require('./policy');
const { pdfNavigationAllowed } = require('./pdf-policy');
const { embeddedNavigationAllowed } = require('./embedded-content-policy');
const { installNavigation } = require('./navigation');
const { APP_ICON } = require('./app-icon');
const { installMailSso } = require('./mail-sso');
function createProtectedWindow({ BrowserWindow, session, prefiller, owners, show, downloads, ready = () => true, Menu = require('electron').Menu, windowOptions = {}, universityWindow, mailReport, checkUpdates, openSsh,
  openExternal = url => require('electron').shell.openExternal(url) }) {
  // Preserve Chromium's popup options (including its opener), then enforce our
  // session and security preferences. Never replay popup requests with loadURL:
  // doing so drops form POST data and breaks the returned WindowProxy.
  const window = new BrowserWindow({ ...windowOptions, title: 'MyNEIGE · Navigation universitaire', icon: APP_ICON, width: 1200, height: 850, show,
    webPreferences: { ...windowOptions.webPreferences, session, preload: path.join(__dirname, '../preload/cas.js'), nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, webRTCIPHandlingPolicy: 'disable_non_proxied_udp', navigateOnDragDrop: false } });
  prefiller.bind(window.webContents);
  owners.set(window.webContents, prefiller);
  downloads?.track(window);
  const mail = installMailSso({ contents: window.webContents, ready, report: mailReport });
  universityWindow ??= window;
  installNavigation({ window, Menu, ready, downloads, universityWindow, checkUpdates, openSsh });
  window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  const httpsPage = value => { try { return new URL(value).protocol === 'https:' && allowedURL(value); } catch { return false; } };
  const openOutside = async value => {
    const url = externalURL(value);
    if (!url || !ready() || window.isDestroyed() || window.webContents.isDestroyed() || !httpsPage(window.webContents.getURL())) return;
    try {
      // Seule l'adresse est transmise : ni cookies, ni corps POST, ni identifiants.
      await openExternal(url);
    } catch {
      if (!window.isDestroyed()) {
        // Ne pas afficher l'URL ou le détail système : ils peuvent contenir des données privées.
        await require('electron').dialog.showMessageBox(window, { type: 'warning', title: 'MyNEIGE',
          message: 'Impossible d’ouvrir le lien dans votre navigateur par défaut.',
          detail: 'Vérifiez qu’un navigateur par défaut est défini dans les paramètres Windows.', buttons: ['OK'] }).catch(() => {});
      }
    }
  };
  for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
    window.webContents.on(event, (details, url) => {
      const target = typeof url === 'string' ? url : details.url;
      const blocked = !allowedURL(target) && !embeddedNavigationAllowed(details) &&
          !(event === 'will-frame-navigate' && pdfNavigationAllowed(details));
      mail.guard(event === 'will-redirect' ? 'REDIRECT' : 'NAVIGATE', target, blocked,
        event === 'will-navigate' || details.isMainFrame);
      if (blocked) {
        details.preventDefault();
        // Cet événement précède will-navigate : une seule ouverture, jamais
        // pour une iframe, une ressource ou une redirection HTTP.
        if (event === 'will-frame-navigate' && details.isMainFrame) void openOutside(target);
      }
    });
  }
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url, postBody }) => {
    const opener = window.webContents.getURL();
    if (externalURL(url)) {
      // Une soumission POST ne peut pas être rejouée dans un autre navigateur.
      if (!postBody) void openOutside(url);
      return { action: 'deny' };
    }
    // An initial empty document is used by sites to prepare a popup before
    // submitting a form. Only a university page may create one.
    if (!ready() || !httpsPage(opener) || !(httpsPage(url) || url === 'about:blank')) return { action: 'deny' };
    return { action: 'allow', createWindow: options => {
      const popup = createProtectedWindow({ BrowserWindow, session, prefiller, owners, show, downloads, ready, Menu, windowOptions: options, universityWindow, mailReport, openExternal, checkUpdates, openSsh });
      downloads?.expectNavigation(popup.webContents, httpsPage(url) ? url : opener);
      return popup.webContents;
    } };
  });
  return window;
}
module.exports = { createProtectedWindow };
