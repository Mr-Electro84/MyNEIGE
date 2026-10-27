'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { app, session, BrowserWindow, ipcMain } = require('electron');
const { createDownloads } = require('../src/main/downloads');
const { createDownloadsWindow } = require('../src/main/downloads-window');
const { installNavigation } = require('../src/main/navigation');
const { Menu } = require('electron');
app.enableSandbox();
app.setPath('userData', path.resolve(__dirname, '../.local/downloads-data'));
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.on('window-all-closed', () => {});
const timer = setTimeout(() => { console.error('DOWNLOADS_TEST timeout'); app.exit(1); }, 30000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 150; i++) { if (await predicate()) return; await pause(20); }
  throw new Error('Événement attendu absent');
}
app.whenReady().then(async () => {
  const directory = path.resolve(__dirname, '../.local/downloads-ui');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'Cours renommé.txt'); fs.writeFileSync(file, 'Document fictif MyNEIGE');
  const local = session.fromPartition('downloads-test-local', { cache: false });
  local.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') }));
  const sourceSession = new EventEmitter(), opened = [];
  let ready = true, failure = false;
  const manager = createDownloads({ session: sourceSession, ready: () => ready, directory,
    show: () => view.show(), shell: {
      openPath: async file => { if (failure) return 'Erreur privée'; opened.push(['open', file]); return ''; },
      showItemInFolder: file => opened.push(['reveal', file])
    } });
  const view = createDownloadsWindow({ BrowserWindow, ipcMain, localSession: local, downloads: manager, show: false });
  // La source simulée déclenche les mêmes événements que Chromium ; aucune connexion universitaire.
  const source = new EventEmitter(); source.webContents = { getURL: () => 'https://www.appigs.univ-avignon.fr/', isDestroyed: () => false };
  source.isDestroyed = () => false; source.setProgressBar = () => {};
  manager.track(source);
  const findWindow = () => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'MyNEIGE · Téléchargements');
  const begin = (name = 'Cours.txt', savedPath = file) => {
    const item = new EventEmitter();
    item.getFilename = () => name; item.getURLChain = () => ['https://www.appigs.univ-avignon.fr/document'];
    item.getTotalBytes = () => 100; item.getReceivedBytes = () => 60;
    item.getSavePath = () => savedPath; item.getStartTime = () => 1793181600; item.getEndTime = () => 1793181620;
    item.setSaveDialogOptions = () => {}; item.cancel = () => item.emit('done', {}, 'cancelled');
    sourceSession.emit('will-download', { preventDefault() { throw new Error('Téléchargement fictif refusé'); } }, item, source.webContents);
    return item;
  };
  try {
    await manager.show(source); let window = findWindow(); assert(window);
    const evaluate = code => window.webContents.executeJavaScript(code);
    assert.equal(await evaluate('document.getElementById("empty").hidden'), false);
    assert.equal(await evaluate('typeof require'), 'undefined');
    assert.equal(await evaluate('typeof process'), 'undefined');
    assert(await evaluate('fetch("https://example.invalid/").then(() => false, () => true)'));
    const first = begin();
    await until(() => evaluate('document.querySelectorAll(".download").length === 1'));
    assert(await evaluate('document.querySelector("[data-action=open]").disabled'));
    assert.equal((await evaluate(`window.myneigeDownloads.action('open', ${manager.records()[0].id})`)).ok, false);
    first.getTotalBytes = () => 0; first.emit('updated', {}, 'progressing');
    await until(() => evaluate('document.querySelector("progress").getAttribute("value") === null && document.body.textContent.includes("Taille totale inconnue")'));
    first.emit('done', {}, 'completed');
    await until(() => evaluate('document.querySelector(".file-name").textContent === "Cours renommé.txt" && !document.querySelector("[data-action=open]").disabled'));
    assert(await evaluate('document.querySelector(".details").textContent.includes("Téléchargé le 28/10/2026")'));
    assert.equal(opened.length, 0);
    // La réouverture par le menu conserve une unique fenêtre et les mêmes lignes.
    const host = new BrowserWindow({ show: false });
    const navigation = installNavigation({ window: host, Menu, ready: () => ready, downloads: manager });
    manager.track(host);
    navigation.menu.getMenuItemById('downloads').click(); await pause(50);
    assert.equal(findWindow(), window); assert.equal(window.getParentWindow(), null);
    const completed = manager.records()[0];
    await evaluate('document.querySelector("[data-action=open]").click()');
    await until(() => opened.length === 1);
    await until(() => evaluate('!document.querySelector("[data-action=reveal]").disabled'));
    await evaluate('document.querySelector("[data-action=reveal]").click()');
    await until(() => opened.length === 2);
    assert.deepEqual(opened, [['open', file], ['reveal', file]]);
    await evaluate('document.querySelector("[data-action=open]").focus()');
    const second = begin('Un autre fichier.txt');
    await until(() => evaluate('document.querySelectorAll(".download").length === 2'));
    assert.equal(await evaluate('document.activeElement.dataset.action'), 'open');
    second.emit('updated', {}, 'progressing');
    await pause(300); assert.equal(await evaluate('document.activeElement.dataset.action'), 'open');
    window.showInactive(); await pause(200);
    fs.writeFileSync(path.join(directory, 'downloads-overview.png'), (await window.webContents.capturePage()).toPNG());
    // Même preload et même page dans une autre fenêtre : toutes les actions sont refusées.
    const foreign = new BrowserWindow({ show: false, webPreferences: { session: local, sandbox: true, contextIsolation: true,
      preload: path.resolve(__dirname, '../src/preload/downloads.js') } });
    await foreign.loadFile(path.resolve(__dirname, '../src/renderer/downloads.html'));
    for (const choice of ['list', 'open', 'reveal', 'cancel-all', 'close'])
      assert.equal((await foreign.webContents.executeJavaScript(`window.myneigeDownloads.action(${JSON.stringify(choice)}, ${completed.id})`)).ok, false);
    foreign.destroy();
    failure = true;
    assert.equal((await evaluate(`window.myneigeDownloads.action('open', ${completed.id})`)).ok, false);
    failure = false;
    fs.unlinkSync(file);
    await evaluate(`document.querySelector('[data-id="${completed.id}"] [data-action=open]').click()`);
    await until(() => evaluate('document.getElementById("message").textContent.includes("déplacé ou supprimé")'));
    assert.equal(opened.length, 2); fs.writeFileSync(file, 'Document fictif MyNEIGE');
    // Une longue chaîne est affichée comme du texte, même si elle ressemble à du HTML.
    const long = begin('<img src=x onerror=alert(1)>' + 'document très long '.repeat(12), ''); long.getTotalBytes = () => 0;
    long.emit('updated', {}, 'progressing');
    await until(() => evaluate('document.querySelectorAll(".download").length === 3'));
    assert.equal(await evaluate('document.querySelectorAll("img").length'), 0);
    window.showInactive(); await pause(200);
    fs.writeFileSync(path.join(directory, 'downloads.png'), (await window.webContents.capturePage()).toPNG());
    window.setSize(520, 430); await pause(200);
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Débordement horizontal');
    assert(await evaluate('document.documentElement.scrollHeight <= innerHeight'), 'Pied de fenêtre tronqué');
    fs.writeFileSync(path.join(directory, 'downloads-narrow.png'), (await window.webContents.capturePage()).toPNG());
    // Fermer la vue ne doit annuler aucun téléchargement.
    window.destroy(); assert(manager.records().some(record => record.active));
    await manager.show(source); window = findWindow(); assert(window);
    await until(() => evaluate('!document.getElementById("cancel-all").hidden'));
    await evaluate('document.getElementById("cancel-all").click()');
    await until(() => !manager.records().some(record => record.active));
    assert.equal(manager.records().filter(record => record.state === 'cancelled').length, 2);
    begin(); await manager.show(source);
    ready = false; manager.stop(); assert(window.isDestroyed());
    assert(!manager.records().some(record => record.active));
    await manager.show(source); assert.equal(findWindow(), undefined);
    host.destroy();
    // Arrêt pendant le chargement : aucune fenêtre orpheline ni promesse rejetée.
    const fresh = createDownloads({ session: new EventEmitter(), ready: () => true, directory });
    view.dispose();
    const loading = createDownloadsWindow({ BrowserWindow, ipcMain, localSession: local, downloads: fresh, show: false });
    const pending = loading.show(); fresh.stop(); await pending;
    assert.equal(findWindow(), undefined); loading.dispose(); fresh.dispose();
    console.log('DOWNLOADS_TEST passed window=true metadata=true trusted_ipc=true file_actions_mocked=true missing_file=true focus=true lifecycle=true no_real_vpn=true');
  } finally { view.dispose(); manager.dispose(); for (const window of BrowserWindow.getAllWindows()) window.destroy(); }
}).then(() => { clearTimeout(timer); app.exit(0); }).catch(error => {
  clearTimeout(timer); console.error('DOWNLOADS_TEST failed: ' + error.stack); app.exit(1);
});
