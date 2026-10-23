'use strict';
const path = require('node:path');
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
function createDownloads({ session, ready, directory, dialog, report = () => {} }) {
  const windows = new Map(), expected = new WeakMap(), active = new Map(), history = [];
  let stopped = false;
  const records = () => history.map(record => ({ name: record.name, state: record.state, received: record.received, total: record.total }));
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
    const record = { name: safeFilename(item.getFilename()), state: 'progressing', received: 0, total: Math.max(0, item.getTotalBytes()), window };
    item.setSaveDialogOptions({ title: 'Enregistrer le fichier', defaultPath: path.join(directory, record.name),
      properties: ['showOverwriteConfirmation', 'createDirectory'] });
    history.unshift(record);
    active.set(item, record); progress(window); report('STARTED');
    item.on('updated', (_event, state) => {
      if (stopped || !ready()) { item.cancel(); return; }
      record.state = state; record.received = item.getReceivedBytes(); record.total = Math.max(0, item.getTotalBytes());
      progress(window);
    });
    item.once('done', (_event, state) => {
      record.state = labels[state] ? state : 'interrupted'; record.received = item.getReceivedBytes();
      active.delete(item); progress(window);
      // Keep recent history bounded without dropping active interrupted items.
      const running = new Set(active.values());
      for (let i = history.length - 1; i >= 20; --i) if (!running.has(history[i])) history.splice(i, 1);
      report(record.state.toUpperCase());
    });
  }
  session.on('will-download', onDownload);
  return {
    records,
    expectNavigation(contents, url) { if (windows.has(contents) && httpsPage(url)) expected.set(contents, url); },
    track(window) {
      const contents = window.webContents;
      windows.set(contents, window);
      window.once('closed', () => {
        windows.delete(contents); expected.delete(contents);
        for (const [item, record] of active) if (record.window === window) item.cancel();
      });
    },
    async show(window) {
      if (!window || window.isDestroyed()) return;
      const detail = records().slice(0, 10).map(record => `${record.name} — ${labels[record.state] || 'Interrompu'} (${Math.ceil(record.received / 1024)} Ko)`).join('\n') || 'Aucun téléchargement pour cette session.';
      const result = await dialog.showMessageBox(window, { type: 'info', title: 'Téléchargements',
        message: active.size ? 'Téléchargements en cours' : 'Téléchargements de la session', detail,
        buttons: active.size ? ['Fermer', 'Annuler les téléchargements en cours'] : ['Fermer'], cancelId: 0, defaultId: 0 });
      if (result.response === 1) cancelAll();
    },
    cancelAll,
    stop() { stopped = true; cancelAll(); },
    dispose() { stopped = true; cancelAll(); session.removeListener('will-download', onDownload); windows.clear(); }
  };
}
module.exports = { createDownloads, downloadAllowed, safeFilename };
