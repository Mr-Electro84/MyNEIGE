'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { APP_ICON } = require('./app-icon');

function createDownloadsWindow({ BrowserWindow, ipcMain, localSession, downloads, show = true }) {
  const file = path.join(__dirname, '../renderer/downloads.html');
  const url = pathToFileURL(file).href;
  let window, loaded, timer, disposed = false;
  const trusted = event => !disposed && window && !window.isDestroyed() &&
    event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === url;
  const snapshot = () => downloads.records();
  function close() {
    clearTimeout(timer); timer = undefined;
    if (window && !window.isDestroyed()) window.destroy();
  }
  function publish() {
    clearTimeout(timer); timer = undefined;
    if (!disposed && window && !window.isDestroyed() && !window.webContents.isLoadingMainFrame())
      window.webContents.send('myneige:downloads-changed', snapshot());
  }
  const unsubscribe = downloads.subscribe(() => {
    if (downloads.isStopped()) { close(); return; }
    // Au plus quatre notifications par seconde, uniquement si la fenêtre est ouverte.
    if (!disposed && window && !timer) timer = setTimeout(publish, 250);
  });
  ipcMain.handle('myneige:downloads-action', async (event, choice, id) => {
    if (!trusted(event) || downloads.isStopped()) return { ok: false };
    if (choice === 'list') return { ok: true, records: snapshot() };
    if (choice === 'close') { close(); return { ok: true }; }
    if (!['open', 'reveal', 'cancel-all'].includes(choice)) return { ok: false };
    return downloads.action(id, choice);
  });
  return {
    async show() {
      if (disposed || downloads.isStopped()) return;
      if (!window) {
        const current = window = new BrowserWindow({ title: 'MyNEIGE · Téléchargements', icon: APP_ICON,
          width: 820, height: 620, minWidth: 520, minHeight: 360, show: false,
          webPreferences: { session: localSession, preload: path.join(__dirname, '../preload/downloads.js'),
            sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, navigateOnDragDrop: false } });
        current.setMenu(null);
        current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        current.webContents.on('will-navigate', event => event.preventDefault());
        current.on('closed', () => {
          if (window === current) { window = undefined; clearTimeout(timer); timer = undefined; }
        });
        loaded = current.loadFile(file);
      }
      const current = window;
      try { await loaded; }
      catch { if (!current.isDestroyed()) current.destroy(); return; }
      if (disposed || downloads.isStopped() || current.isDestroyed()) return;
      publish();
      if (show) { if (current.isMinimized()) current.restore(); current.show(); current.focus(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true; unsubscribe(); close(); ipcMain.removeHandler('myneige:downloads-action');
    }
  };
}
module.exports = { createDownloadsWindow };
