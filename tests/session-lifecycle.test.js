'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const { createSessionLifecycle } = require('../src/main/session-lifecycle');

function fixture() {
  const ipcMain = new EventEmitter(), windows = [], sent = [], states = [];
  let ready = true, finishLoad;
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; windows.push(this);
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.webContents.send = (...args) => states.push(args);
      this.webContents.setWindowOpenHandler = handler => { this.open = handler; };
    }
    setMenu() {}
    isDestroyed() { return Boolean(this.destroyed); }
    destroy() { this.destroyed = true; this.emit('closed'); }
    show() { this.shown = true; }
    focus() {}
    async loadFile(file) {
      this.webContents.mainFrame.url = pathToFileURL(file).href;
      if (finishLoad) await finishLoad;
    }
  }
  const localSession = {};
  const lifecycle = createSessionLifecycle({ BrowserWindow: Window, ipcMain, localSession, ready: () => ready,
    parent: () => undefined, send: value => sent.push(value), stop: () => states.push('STOP'),
    expired: async () => { ready = false; states.push('EXPIRED'); }, extended: () => states.push('EXTENDED') });
  const action = (value, event) => {
    const window = windows.at(-1);
    ipcMain.emit('myneige:session-action', event || { sender: window.webContents, senderFrame: window.webContents.mainFrame }, value);
  };
  return { lifecycle, windows, states, sent, action, ipcMain, localSession,
    block: () => { ready = false; }, delay: promise => { finishLoad = promise; } };
}
test('avertissement local sandboxé : aucun bridge ni session universitaire', async () => {
  const f = fixture(); await f.lifecycle.warning(300);
  const window = f.windows[0];
  assert.equal(window.options.webPreferences.session, f.localSession);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.open({ url: 'https://evil.test/' }).action, 'deny');
  let prevented = false;
  window.webContents.emit('will-navigate', { preventDefault() { prevented = true; } });
  assert(prevented); assert(window.shown);
  assert.equal(f.states[0][0], 'myneige:session-warning');
});
test('les pages distantes, sous-frames et URL étrangères ne peuvent prolonger', async () => {
  const f = fixture(); await f.lifecycle.warning(300);
  const contents = f.windows[0].webContents;
  f.action('extend', { sender: {}, senderFrame: contents.mainFrame });
  f.action('extend', { sender: contents, senderFrame: { url: contents.mainFrame.url } });
  const url = contents.mainFrame.url; contents.mainFrame.url = 'https://cas.univ-avignon.fr/';
  f.action('extend'); contents.mainFrame.url = url;
  f.action('other');
  assert.deepEqual(f.sent, []);
  f.action('extend'); f.action('extend');
  assert.deepEqual(f.sent, ['UI_SESSION_EXTEND']);
  assert(!f.windows[0].destroyed, 'Le clic attend la confirmation du contrôleur');
  f.lifecycle.extended();
  assert(f.windows[0].destroyed); assert(f.states.includes('EXTENDED'));
});
test('plusieurs cycles restent possibles sans redémarrer la session', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) {
    await f.lifecycle.warning(300); f.action('extend'); f.lifecycle.extended();
  }
  assert.equal(f.sent.length, 3); assert.equal(f.windows.length, 3);
  f.lifecycle.dispose(); assert.equal(f.ipcMain.listenerCount('myneige:session-action'), 0);
});
test('expiration ferme l’avertissement et interdit toute prolongation tardive', async () => {
  const f = fixture(); await f.lifecycle.warning(1); f.action('extend');
  await f.lifecycle.expire(); await f.lifecycle.expire();
  f.lifecycle.extended(); f.action('extend'); await f.lifecycle.warning(300);
  assert(f.windows[0].destroyed);
  assert.equal(f.states.filter(state => state === 'EXPIRED').length, 1);
  assert(!f.states.includes('EXTENDED')); assert.equal(f.windows.length, 1);
});
test('un chargement retardé ne réaffiche pas un avertissement après expiration', async () => {
  const f = fixture(); let release;
  f.delay(new Promise(resolve => { release = resolve; }));
  const loading = f.lifecycle.warning(300);
  await f.lifecycle.expire(); release(); await loading;
  assert(f.windows[0].destroyed); assert(!f.windows[0].shown);
});
test('une perte VPN empêche les actions et un nouvel avertissement', async () => {
  const f = fixture(); await f.lifecycle.warning(300); f.block();
  f.action('extend'); f.action('stop'); f.lifecycle.extended();
  await f.lifecycle.warning(300);
  assert.deepEqual(f.sent, []); assert.equal(f.windows.length, 1);
});
test('annuler le chargement pendant l’expiration ne provoque pas un arrêt en erreur', async () => {
  const f = fixture(); let reject;
  f.delay(new Promise((_resolve, fail) => { reject = fail; }));
  const loading = f.lifecycle.warning(300);
  await f.lifecycle.expire(); reject(new Error('ERR_ABORTED'));
  await assert.doesNotReject(loading);
  assert(f.states.includes('EXPIRED'));
});
test('fermer l’avertissement ne prolonge et ne termine rien', async () => {
  const f = fixture(); await f.lifecycle.warning(300); f.windows[0].destroy();
  assert.deepEqual(f.sent, []); assert.deepEqual(f.states.filter(state => typeof state === 'string'), []);
});
test('Terminer reste disponible pendant une demande de prolongation', async () => {
  const f = fixture(); await f.lifecycle.warning(300); f.action('extend'); f.action('stop');
  assert(f.states.includes('STOP'));
});
