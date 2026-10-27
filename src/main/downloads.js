'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { allowedURL } = require('./policy');

function httpsPage(value) {
  try { return new URL(value).protocol === 'https:' && allowedURL(value); } catch { return false; }
}
function downloadAllowed(chain, source) {
  if (!httpsPage(source) || !Array.isArray(chain) || !chain.length) return false;
  return chain.every(value => {
    if (httpsPage(value)) return true;
    try {
      const url = new URL(value);
      return chain.length === 1 && url.protocol === 'blob:' && httpsPage(url.pathname) &&
        new URL(url.pathname).origin === new URL(source).origin;
    } catch { return false; }
  });
}
function safeFilename(value) {
  let name = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_').replace(/[. ]+$/g, '').trim();
  name = Array.from(name).slice(0, 160).join('').replace(/[. ]+$/g, '');
  if (!name || /^\.+$/.test(name)) name = 'fichier';
  if (/^(con(?:in\$|out\$)?|clock\$|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])[ .]*(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}
const labels = { progressing: 'En cours', completed: 'Terminé', cancelled: 'Annulé', interrupted: 'Interrompu' };
function createDownloads({ session, ready, directory, show = async () => {}, report = () => {},
  shell, fileSystem = fs.promises, now = Date.now }) {
  const windows = new Map(), expected = new WeakMap(), active = new Map(), history = [], listeners = new Set(), opening = new Set();
  let stopped = false, sequence = 0;
  // Le chemin reste exclusivement dans le processus principal.
  const records = () => {
    const running = new Set(active.values());
    return history.map(record => ({ id: record.id, name: record.name, state: record.state, received: record.received,
      total: record.total, startedAt: record.startedAt, endedAt: record.endedAt, active: running.has(record),
      canOpen: record.state === 'completed' && Boolean(record.savedPath) }));
  };
  const notify = () => { for (const listener of listeners) listener(); };
  function trimHistory() {
    const running = new Set(active.values());
    for (let i = history.length - 1; i >= 20; --i) if (!running.has(history[i])) history.splice(i, 1);
  }
  function timestamp(seconds) { return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : now(); }
  function progress(window) {
    if (!window || window.isDestroyed()) return;
    const tasks = [...active.values()].filter(task => task.window === window);
    const total = tasks.reduce((sum, task) => sum + task.total, 0);
    const received = tasks.reduce((sum, task) => sum + task.received, 0);
    window.setProgressBar(!tasks.length ? -1 : tasks.some(task => !task.total) ? 2 : Math.min(received / total, 1));
  }
  function cancelAll() { for (const item of [...active.keys()]) item.cancel(); }
  function onDownload(event, item, contents, frame) {
    const window = windows.get(contents);
    let allowed = false;
    try {
      let source = frame?.url || contents.getURL();
      if (!source || ['about:blank', 'about:srcdoc'].includes(source)) {
        const page = contents.getURL();
        source = httpsPage(page) ? page : expected.get(contents);
      }
      allowed = !stopped && ready() && window && !window.isDestroyed() && !contents.isDestroyed() &&
        downloadAllowed(item.getURLChain(), source);
    } catch { /* Missing provenance is refused. */ }
    if (!allowed) { event.preventDefault(); report('REFUSED'); return; }
    const record = { id: ++sequence, name: safeFilename(item.getFilename()), state: 'progressing', received: 0,
      total: Math.max(0, item.getTotalBytes()), startedAt: timestamp(item.getStartTime?.()), endedAt: null, savedPath: '', window };
    item.setSaveDialogOptions({ title: 'Enregistrer le fichier', defaultPath: path.join(directory, record.name),
      properties: ['showOverwriteConfirmation', 'createDirectory'] });
    history.unshift(record);
    active.set(item, record); trimHistory(); progress(window); notify(); report('STARTED');
    item.on('updated', (_event, state) => {
      if (stopped || !ready()) { item.cancel(); return; }
      record.state = state; record.received = item.getReceivedBytes(); record.total = Math.max(0, item.getTotalBytes());
      const savedPath = item.getSavePath?.();
      if (typeof savedPath === 'string' && path.isAbsolute(savedPath)) record.name = path.basename(savedPath);
      progress(window); notify();
    });
    item.once('done', (_event, state) => {
      record.state = labels[state] ? state : 'interrupted'; record.received = item.getReceivedBytes();
      record.total = Math.max(0, item.getTotalBytes()); record.endedAt = timestamp(item.getEndTime?.());
      if (record.state === 'completed') {
        const savedPath = item.getSavePath?.();
        if (typeof savedPath === 'string' && path.isAbsolute(savedPath)) {
          record.savedPath = savedPath; record.name = path.basename(savedPath);
        }
      }
      active.delete(item); progress(window);
      record.window = undefined;
      trimHistory(); notify(); report(record.state.toUpperCase());
    });
  }
  session.on('will-download', onDownload);
  return {
    records,
    isStopped: () => stopped,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async action(id, choice) {
      if (stopped || !ready()) return { ok: false, message: 'La session est terminée ou indisponible.' };
      if (choice === 'cancel-all') { cancelAll(); return { ok: true }; }
      const record = history.find(record => record.id === id);
      if (!['open', 'reveal'].includes(choice) || !record || record.state !== 'completed' || !record.savedPath)
        return { ok: false, message: 'Ce fichier ne peut pas être ouvert.' };
      if (opening.has(id)) return { ok: false, message: 'Une ouverture est déjà en cours.' };
      opening.add(id);
      try {
        const info = await fileSystem.stat(record.savedPath);
        if (!info.isFile()) return { ok: false, message: 'Le fichier a été déplacé ou supprimé.' };
        // L'arrêt de session ou le retrait de l'historique peut survenir pendant stat().
        if (stopped || !ready() || !history.includes(record)) return { ok: false, message: 'Action devenue indisponible.' };
        const desktop = shell || require('electron').shell;
        if (choice === 'reveal') desktop.showItemInFolder(record.savedPath);
        else if (await desktop.openPath(record.savedPath)) return { ok: false, message: 'Windows ne peut pas ouvrir ce fichier. Vérifiez qu’une application adaptée est installée.' };
        return { ok: true };
      } catch (error) {
        return { ok: false, message: error?.code === 'ENOENT' ? 'Le fichier a été déplacé ou supprimé.' : 'Impossible d’accéder à ce fichier ou de l’ouvrir.' };
      } finally { opening.delete(id); }
    },
    expectNavigation(contents, url) { if (windows.has(contents) && httpsPage(url)) expected.set(contents, url); },
    track(window) {
      const contents = window.webContents;
      windows.set(contents, window);
      window.once('closed', () => {
        windows.delete(contents); expected.delete(contents);
        for (const [item, record] of active) if (record.window === window) item.cancel();
      });
    },
    async show(window) { if (!stopped && ready() && windows.has(window?.webContents) && !window.isDestroyed()) await show(window); },
    cancelAll,
    stop() { stopped = true; cancelAll(); notify(); },
    dispose() { stopped = true; cancelAll(); notify(); listeners.clear(); history.length = 0;
      session.removeListener('will-download', onDownload); windows.clear(); }
  };
}
module.exports = { createDownloads, downloadAllowed, safeFilename };
