'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDownloads, downloadAllowed, safeFilename } = require('../src/main/downloads');
const PAGE = 'https://www.appigs.univ-avignon.fr/extranet/etu_suivi.html';
test('download chain permits university HTTPS and only same-origin blobs', () => {
  assert(downloadAllowed([PAGE, 'https://services.univ-avignon.fr/document.pdf'], PAGE));
  assert(downloadAllowed(['blob:https://www.appigs.univ-avignon.fr/fake-id'], PAGE));
  for (const chain of [[], ['http://www.appigs.univ-avignon.fr/f.pdf'], ['file:///C:/secret'], ['data:text/plain,secret'],
    ['https://univ-avignon.fr.evil.test/f'], [PAGE, 'https://evil.test/file'], ['https://u@cas.univ-avignon.fr/file'],
    ['blob:https://cas.univ-avignon.fr/fake-id'], ['blob:null/fake-id']]) assert(!downloadAllowed(chain, PAGE));
  assert(!downloadAllowed([PAGE], 'about:blank'));
});
test('suggested filenames cannot contain paths, device names, streams or bidi controls', () => {
  for (const input of ['../secret.pdf', 'C:\\folder\\file.pdf', 'report.pdf:payload', 'x\u202eexe.pdf', 'a\0b.pdf']) {
    assert(!/[<>:"/\\|?*\x00-\x1f\u202a-\u202e]/.test(safeFilename(input)));
  }
  assert.equal(safeFilename('NUL.txt'), '_NUL.txt'); assert.equal(safeFilename('COM1'), '_COM1');
  assert.equal(safeFilename('CON .txt'), '_CON .txt'); assert.equal(safeFilename('CONOUT$'), '_CONOUT$');
  assert.equal(safeFilename('...'), 'fichier'); assert.equal(safeFilename('document.pdf'), 'document.pdf');
  assert(Array.from(safeFilename('é'.repeat(300) + '.pdf')).length <= 160);
});
function fixture() {
  const session = new EventEmitter(), window = new EventEmitter(), statuses = [];
  let ready = true, url = PAGE;
  window.webContents = { getURL: () => url, isDestroyed: () => false };
  window.isDestroyed = () => false; window.setProgressBar = () => {};
  const manager = createDownloads({ session, ready: () => ready, directory: 'D:\\downloads', dialog: {}, report: value => statuses.push(value) });
  manager.track(window);
  const item = new EventEmitter();
  item.getFilename = () => 'test.pdf'; item.getTotalBytes = () => 100; item.getReceivedBytes = () => 40;
  item.getURLChain = () => [PAGE]; item.setSaveDialogOptions = value => { item.options = value; };
  item.cancel = () => { item.emit('done', {}, 'cancelled'); };
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  return { manager, session, window, item, event, statuses,
    block: () => { ready = false; }, blank: () => { url = 'about:blank'; },
    start: () => session.emit('will-download', event, item, window.webContents) };
}
test('file save is offered only for known windows with a ready VPN', () => {
  const f = fixture(); f.start();
  assert(!f.event.prevented); assert(f.item.options.defaultPath.endsWith('test.pdf'));
  assert.deepEqual(f.statuses, ['STARTED']);
  f.item.emit('done', {}, 'completed'); assert.equal(f.manager.records()[0].state, 'completed');
  const blocked = fixture(); blocked.block(); blocked.start();
  assert(blocked.event.prevented); assert(!blocked.item.options); assert.deepEqual(blocked.manager.records(), []);
  const unknown = fixture(); unknown.session.emit('will-download', unknown.event, unknown.item, { getURL: () => PAGE });
  assert(unknown.event.prevented);
});
test('VPN loss, window closure and session stop cancel only active session downloads', () => {
  const f = fixture(); f.start(); f.block(); f.item.emit('updated', {}, 'progressing');
  assert.equal(f.manager.records()[0].state, 'cancelled');
  const closing = fixture(); closing.start(); closing.window.emit('closed');
  assert.equal(closing.manager.records()[0].state, 'cancelled');
  const stopped = fixture(); stopped.start(); stopped.manager.stop();
  assert.equal(stopped.manager.records()[0].state, 'cancelled');
  assert(!('url' in stopped.manager.records()[0])); assert(!('path' in stopped.manager.records()[0]));
});
test('a download popup may use only its explicitly approved initial target', () => {
  const f = fixture(); f.blank(); f.start(); assert(f.event.prevented);
  const approved = fixture(); approved.blank(); approved.manager.expectNavigation(approved.window.webContents, PAGE); approved.start();
  assert(!approved.event.prevented); approved.manager.stop();
});
