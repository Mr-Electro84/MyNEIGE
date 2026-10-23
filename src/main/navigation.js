'use strict';
const { START_URL, allowedURL } = require('./policy');
const bindings = new WeakMap();
function historyTarget(contents, offset) {
  const history = contents.navigationHistory;
  if (!history.canGoToOffset(offset)) return false;
  const entry = history.getEntryAtIndex(history.getActiveIndex() + offset);
  return Boolean(entry && allowedURL(entry.url));
}
function installNavigation({ window, Menu, ready, downloads }) {
  const contents = window.webContents;
  const run = action => {
    if (window.isDestroyed() || contents.isDestroyed() || !ready()) return;
    if (action === 'back' && historyTarget(contents, -1)) contents.navigationHistory.goBack();
    else if (action === 'forward' && historyTarget(contents, 1)) contents.navigationHistory.goForward();
    else if (action === 'home') void contents.loadURL(START_URL).catch(() => {});
  };
  const menu = Menu.buildFromTemplate([
    { label: 'Navigation', submenu: [
      { id: 'back', label: 'Précédent', accelerator: 'Alt+Left', enabled: false, click: () => run('back') },
      { id: 'forward', label: 'Suivant', accelerator: 'Alt+Right', enabled: false, click: () => run('forward') },
      { type: 'separator' },
      { id: 'home', label: 'Accueil APPIGS', accelerator: 'Alt+Home', click: () => run('home') }
    ] },
    { label: 'Fichiers', submenu: [
      { id: 'downloads', label: 'Téléchargements…', accelerator: 'Control+J', enabled: Boolean(downloads),
        click: () => { void downloads?.show(window).catch(() => {}); } }
    ] }
  ]);
  const refresh = () => {
    if (window.isDestroyed() || contents.isDestroyed()) return;
    menu.getMenuItemById('back').enabled = ready() && historyTarget(contents, -1);
    menu.getMenuItemById('forward').enabled = ready() && historyTarget(contents, 1);
    menu.getMenuItemById('home').enabled = ready();
  };
  window.setMenu(menu); window.setMenuBarVisibility(true);
  for (const event of ['did-navigate', 'did-navigate-in-page', 'did-finish-load', 'did-fail-load']) contents.on(event, refresh);
  refresh();
  const binding = { menu, refresh };
  bindings.set(window, binding);
  return binding;
}
module.exports = { installNavigation, historyTarget, navigationFor: window => bindings.get(window) };
