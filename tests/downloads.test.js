'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDownloads, downloadAllowed, safeFilename } = require('../src/main/downloads');
const PAGE = 'https://www.appigs.univ-avignon.fr/extranet/etu_suivi.html';
test('download chain permits university HTTPS and only same-origin blobs', () => {
  assert(downloadAllowed([PAGE, 'https://services.univ-avignon.fr/document.pdf'], PAGE));
  assert(downloadAllowed(['https://webmail.partage.renater.fr/attachment'], 'https://webmail.partage.renater.fr/'));
  assert(!downloadAllowed(['https://rr1.googlevideo.com/videoplayback'], PAGE));
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
function fixture(options = {}) {
  const session = new EventEmitter(), window = new EventEmitter(), statuses = [];
  let ready = true, url = PAGE;
  window.webContents = { getURL: () => url, isDestroyed: () => false };
  window.isDestroyed = () => false; window.setProgressBar = () => {};
  const manager = createDownloads({ session, ready: () => ready, directory: 'D:\\downloads', report: value => statuses.push(value), ...options });
  manager.track(window);
  function newItem() {
    const item = new EventEmitter();
    item.getFilename = () => 'test.pdf'; item.getTotalBytes = () => 100; item.getReceivedBytes = () => 40;
    item.getSavePath = () => 'D:\\downloads\\test.pdf'; item.getStartTime = () => 1000; item.getEndTime = () => 1002;
    item.getURLChain = () => [PAGE]; item.setSaveDialogOptions = value => { item.options = value; };
    item.cancel = () => { item.emit('done', {}, 'cancelled'); };
    return item;
  }
  const item = newItem();
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  return { manager, session, window, item, event, statuses, newItem,
    block: () => { ready = false; }, blank: () => { url = 'about:blank'; },
    start: (download = item) => session.emit('will-download', event, download, window.webContents) };
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

test('metadata uses the saved filename, actual bytes and download timestamps without exposing its path', () => {
  const f = fixture();
  f.item.getSavePath = () => 'D:\\ailleurs\\Document renommé.pdf';
  f.start();
  assert.equal(f.manager.records()[0].startedAt, 1000000);
  assert.equal(f.manager.records()[0].endedAt, null);
  assert.equal(f.manager.records()[0].canOpen, false);
  f.item.getTotalBytes = () => 0;
  f.item.emit('updated', {}, 'progressing');
  assert.equal(f.manager.records()[0].total, 0);
  f.item.emit('done', {}, 'completed');
  const record = f.manager.records()[0];
  assert.equal(record.name, 'Document renommé.pdf'); assert.equal(record.received, 40);
  assert.equal(record.endedAt, 1002000); assert.equal(record.active, false); assert.equal(record.canOpen, true);
  assert(!JSON.stringify(record).includes('ailleurs')); assert(!('savedPath' in record));
  assert.deepEqual(f.statuses, ['STARTED', 'COMPLETED']);
});

test('only completed session files can be opened or revealed using their saved path', async () => {
  const calls = [];
  const f = fixture({ fileSystem: { stat: async () => ({ isFile: () => true }) }, shell: {
    openPath: async file => { calls.push(['open', file]); return ''; }, showItemInFolder: file => calls.push(['reveal', file])
  } });
  f.start(); const id = f.manager.records()[0].id;
  assert.equal((await f.manager.action(id, 'open')).ok, false);
  f.item.emit('done', {}, 'completed');
  assert.equal((await f.manager.action('D:\\secret.txt', 'open')).ok, false);
  assert.equal((await f.manager.action(id, 'unknown')).ok, false);
  assert.equal((await f.manager.action(id, 'open')).ok, true);
  assert.equal((await f.manager.action(id, 'reveal')).ok, true);
  assert.deepEqual(calls, [['open', 'D:\\downloads\\test.pdf'], ['reveal', 'D:\\downloads\\test.pdf']]);
  f.block(); assert.equal((await f.manager.action(id, 'open')).ok, false); assert.equal(calls.length, 2);
});

test('missing files, folders and OS failures produce generic local errors', async () => {
  let mode = 'missing', calls = 0;
  const f = fixture({ fileSystem: { stat: async () => {
    if (mode === 'missing') throw Object.assign(new Error('D:\\private\\file.pdf'), { code: 'ENOENT' });
    return { isFile: () => mode !== 'folder' };
  } }, shell: { openPath: async () => { calls++; if (mode === 'throw') throw new Error('D:\\private'); return 'D:\\private: OS failure'; } } });
  f.start(); f.item.emit('done', {}, 'completed'); const id = f.manager.records()[0].id;
  for (const value of ['missing', 'folder', 'os-error', 'throw']) {
    mode = value; const result = await f.manager.action(id, 'open');
    assert.equal(result.ok, false); assert(!JSON.stringify(result).includes('private'));
  }
  assert.equal(calls, 2);
});

test('session stop during file verification prevents opening and concurrent actions are bounded', async () => {
  let finish, calls = 0;
  const f = fixture({ fileSystem: { stat: () => new Promise(resolve => { finish = resolve; }) },
    shell: { openPath: async () => { calls++; return ''; } } });
  f.start(); f.item.emit('done', {}, 'completed'); const id = f.manager.records()[0].id;
  const pending = f.manager.action(id, 'open');
  assert.equal((await f.manager.action(id, 'reveal')).ok, false);
  f.manager.stop(); finish({ isFile: () => true });
  assert.equal((await pending).ok, false); assert.equal(calls, 0);
});

test('cancelled files and incomplete saved paths never enable file actions', async () => {
  for (const state of ['cancelled', 'interrupted', 'completed']) {
    const f = fixture(); f.item.getSavePath = () => 'relative.pdf'; f.start(); f.item.emit('done', {}, state);
    assert.equal(f.manager.records()[0].canOpen, false);
    assert.equal((await f.manager.action(f.manager.records()[0].id, 'open')).ok, false);
  }
});

test('recent history stays bounded while retaining an old active interrupted download', () => {
  const f = fixture(); let notifications = 0;
  const unsubscribe = f.manager.subscribe(() => notifications++);
  f.start(); const first = f.manager.records()[0].id;
  f.item.emit('updated', {}, 'interrupted');
  for (let i = 0; i < 30; i++) {
    const item = f.newItem(); f.start(item); item.emit('done', {}, 'completed');
  }
  assert.equal(f.manager.records().length, 21);
  assert(f.manager.records().some(record => record.id === first && record.active));
  assert(notifications > 30); unsubscribe(); const before = notifications;
  f.manager.stop(); assert.equal(notifications, before); assert.equal(f.manager.records().length, 20);
  f.manager.dispose(); assert.equal(f.session.listenerCount('will-download'), 0);
});

test('the window opens only for a tracked source and never starts file actions automatically', async () => {
  let shown = 0;
  const f = fixture({ show: async () => { shown++; } });
  await f.manager.show(f.window); assert.equal(shown, 1);
  await f.manager.show({ webContents: {}, isDestroyed: () => false }); assert.equal(shown, 1);
  f.start(); f.item.emit('done', {}, 'completed'); assert.equal(shown, 1);
  f.manager.stop(); await f.manager.show(f.window); assert.equal(shown, 1);
});
