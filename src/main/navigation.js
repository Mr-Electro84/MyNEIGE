'use strict';
const { START_URL, allowedURL } = require('./policy');
const { helpMenu } = require('./about');
const UNIVERSITY_LINKS = Object.freeze([
  { id: 'university-ent', label: 'ENT', url: 'https://ent.univ-avignon.fr/' },
  { id: 'university-directory', label: 'Annuaire (VPN)', url: 'https://annuaire.univ-avignon.fr/' },
  { id: 'university-projects', label: 'Gestionnaire de projets (VPN)', url: 'https://projets.univ-avignon.fr/' },
  { id: 'university-moodle', label: 'E-UAPV/Moodle', url: 'https://e-uapv.univ-avignon.fr/' },
  { id: 'university-timetable', label: 'EDT', url: 'https://edt.univ-avignon.fr/' },
  { id: 'university-mail', label: 'Mail', url: 'https://partage.univ-avignon.fr/' },
  { id: 'university-nextcloud', label: 'Nextcloud', url: 'https://cloud.univ-avignon.fr/' }
].map(link => Object.freeze(link)));
const bindings = new WeakMap();
function historyTarget(contents, offset) {
  const history = contents.navigationHistory;
  if (!history.canGoToOffset(offset)) return false;
  const entry = history.getEntryAtIndex(history.getActiveIndex() + offset);
  return Boolean(entry && allowedURL(entry.url));
}
function installNavigation({ window, Menu, ready, downloads, universityWindow = window }) {
  const contents = window.webContents;
  const canVisitUniversity = () => ready() && !universityWindow.isDestroyed() && !universityWindow.webContents.isDestroyed();
  const visitUniversity = url => {
    if (window.isDestroyed() || !canVisitUniversity() || !allowedURL(url)) return;
    if (universityWindow.isMinimized()) universityWindow.restore();
    if (universityWindow.isVisible()) universityWindow.focus();
    void universityWindow.webContents.loadURL(url).catch(() => {});
  };
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
    { label: 'Université', submenu: UNIVERSITY_LINKS.map(({ id, label, url }) => ({
      id, label, click: () => visitUniversity(url)
    })) },
    { label: 'Fichiers', submenu: [
      { id: 'downloads', label: 'Téléchargements…', accelerator: 'Control+J', enabled: Boolean(downloads),
        click: () => { void downloads?.show(window).catch(() => {}); } }
    ] },
    helpMenu(window)
  ]);
  const refresh = () => {
    if (window.isDestroyed() || contents.isDestroyed()) return;
    menu.getMenuItemById('back').enabled = ready() && historyTarget(contents, -1);
    menu.getMenuItemById('forward').enabled = ready() && historyTarget(contents, 1);
    menu.getMenuItemById('home').enabled = ready();
    for (const { id } of UNIVERSITY_LINKS) menu.getMenuItemById(id).enabled = canVisitUniversity();
  };
  window.setMenu(menu); window.setMenuBarVisibility(true);
  for (const event of ['did-navigate', 'did-navigate-in-page', 'did-finish-load', 'did-fail-load']) contents.on(event, refresh);
  if (universityWindow !== window) {
    universityWindow.on('closed', refresh);
    window.once('closed', () => universityWindow.removeListener('closed', refresh));
  }
  refresh();
  const binding = { menu, refresh };
  bindings.set(window, binding);
  return binding;
}
module.exports = { UNIVERSITY_LINKS, installNavigation, historyTarget, navigationFor: window => bindings.get(window) };
