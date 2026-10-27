'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { APP_ICON } = require('./app-icon');
const { SITE } = require('./updates');

function createUpdateToast({ BrowserWindow, ipcMain, localSession, screen, dialog, action, show = true,
  openExternal = url => require('electron').shell.openExternal(url) }) {
  const file = path.join(__dirname, '../renderer/update-toast.html');
  const url = pathToFileURL(file).href;
  let toast, loaded, stopped = false;
  const handler = async (event, choice) => {
    if (stopped || !toast || event.sender !== toast.webContents ||
        event.senderFrame !== toast.webContents.mainFrame || event.senderFrame.url !== url) return { ok: false };
    if (choice === 'close') { toast.destroy(); return { ok: true }; }
    let result;
    if (choice === 'website') {
      // URL fixe dans le processus principal, jamais fournie par le renderer.
      try { await openExternal(SITE); result = { ok: true }; }
      catch { result = { ok: false }; }
    } else result = await action(choice);
    if (stopped || !toast || toast.isDestroyed()) return result;
    if (result.ok) {
      // La seule alerte est celle demandée après le refus définitif.
      if (result.remind) await dialog.showMessageBox(toast, { type: 'info', title: 'Mises à jour MyNEIGE',
        message: `N'oubliez pas à l'avenir de mettre à jour depuis le site de MyNEIGE (${SITE})`, buttons: ['OK'] });
      toast?.destroy(); toast = undefined;
    }
    return result;
  };
  ipcMain.handle('myneige:update-action', handler);
  async function display(value) {
    if (stopped) return;
    if (toast) {
      const window = toast;
      await loaded;
      if (!stopped && !window.isDestroyed()) {
        window.webContents.send('myneige:update-offer', value);
        if (show) window.showInactive();
      }
      return;
    }
    const focused = BrowserWindow.getFocusedWindow();
    const { workArea } = focused ? screen.getDisplayMatching(focused.getBounds()) : screen.getPrimaryDisplay();
    const width = Math.min(560, workArea.width), height = Math.min(310, workArea.height);
    const window = toast = new BrowserWindow({ title: 'MyNEIGE · Mise à jour', icon: APP_ICON,
      width, height, x: workArea.x + workArea.width - width, y: workArea.y + workArea.height - height,
      show: false, frame: false, resizable: false, minimizable: false, maximizable: false,
      alwaysOnTop: true, skipTaskbar: true,
      webPreferences: { session: localSession, preload: path.join(__dirname, '../preload/update-toast.js'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('closed', () => { if (toast === window) toast = undefined; });
    try {
      loaded = window.loadFile(file);
      await loaded;
      if (stopped || window.isDestroyed()) return;
      window.webContents.send('myneige:update-offer', value);
      if (show) window.showInactive();
    } catch { if (!window.isDestroyed()) window.destroy(); }
  }
  return {
    notify: candidate => display({ status: 'available', version: candidate.version }),
    status: status => display({ status }),
    dispose() {
      stopped = true; ipcMain.removeHandler('myneige:update-action');
      if (toast && !toast.isDestroyed()) toast.destroy(); toast = undefined;
    }
  };
}
module.exports = { createUpdateToast };
