'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { APP_ICON } = require('./app-icon');

// Cette fenêtre locale ne partage ni la session ni le preload des sites.
function createSessionLifecycle({ BrowserWindow, ipcMain, localSession, ready, send, stop, expired, extended,
  parent = () => BrowserWindow.getFocusedWindow(), show = true }) {
  const noticePath = path.join(__dirname, '../renderer/session-warning.html');
  const noticeURL = pathToFileURL(noticePath).href;
  let notice, pending = false, ended = false;
  const trusted = event => notice && !notice.isDestroyed() && event.sender === notice.webContents &&
    event.senderFrame === notice.webContents.mainFrame && event.senderFrame.url === noticeURL;
  function closeNotice() {
    const window = notice;
    notice = undefined; pending = false;
    if (window && !window.isDestroyed()) window.destroy();
  }
  const action = (event, value) => {
    if (!trusted(event) || !ready() || ended) return;
    if (value === 'extend') {
      if (pending) return;
      pending = true;
      notice.webContents.send('myneige:session-pending');
      send('UI_SESSION_EXTEND');
    } else if (value === 'stop') stop();
  };
  ipcMain.on('myneige:session-action', action);
  return {
    async warning(seconds) {
      if (ended || !ready() || !Number.isInteger(seconds) || seconds < 1 || seconds > 300) return;
      closeNotice();
      const owner = parent();
      const window = new BrowserWindow({ title: 'MyNEIGE · Fin de session', icon: APP_ICON,
        width: 580, height: 420, resizable: false, minimizable: false, show: false,
        parent: owner && !owner.isDestroyed() ? owner : undefined,
        webPreferences: { session: localSession, preload: path.join(__dirname, '../preload/session-warning.js'),
          nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
      notice = window;
      window.setMenu(null);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.once('closed', () => { if (notice === window) { notice = undefined; pending = false; } });
      const started = performance.now();
      try { await window.loadFile(noticePath); }
      catch (error) {
        // L'expiration ou l'arrêt peut détruire la fenêtre pendant son
        // chargement. Cette annulation attendue ne doit pas fermer l'écran final.
        if (notice !== window || ended) return;
        throw error;
      }
      if (notice !== window || ended || !ready()) return;
      window.webContents.send('myneige:session-warning', Math.max(0, seconds - (performance.now() - started) / 1000));
      if (show) { window.show(); window.focus(); }
    },
    extended() {
      if (ended || !ready()) return;
      closeNotice(); extended();
    },
    async expire() {
      if (ended) return;
      ended = true;
      closeNotice();
      await expired();
    },
    dispose() { ended = true; closeNotice(); ipcMain.removeListener('myneige:session-action', action); }
  };
}
module.exports = { createSessionLifecycle };
