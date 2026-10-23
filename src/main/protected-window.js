'use strict';
const path = require('node:path');
const { allowedURL } = require('./policy');
function createProtectedWindow({ BrowserWindow, session, prefiller, owners, show }) {
  const window = new BrowserWindow({ title: 'MyNEIGE · Navigation universitaire', width: 1200, height: 850, show,
    webPreferences: { session, preload: path.join(__dirname, '../preload/cas.js'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, webRTCIPHandlingPolicy: 'disable_non_proxied_udp', navigateOnDragDrop: false } });
  prefiller.bind(window.webContents);
  owners.set(window.webContents, prefiller);
  window.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
    window.webContents.on(event, (event, url) => { if (!allowedURL(typeof url === 'string' ? url : event.url)) event.preventDefault(); });
  }
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedURL(url)) {
      const popup = createProtectedWindow({ BrowserWindow, session, prefiller, owners, show });
      popup.loadURL(url).catch(() => {});
    }
    return { action: 'deny' };
  });
  return window;
}
module.exports = { createProtectedWindow };
