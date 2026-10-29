'use strict';
const fs = require('node:fs/promises');

// Seul le formulaire local reçoit l'état public. Le contenu reste dans le main,
// l'auxiliaire DPAPI et le canal authentifié du contrôleur.
function createVpnProfile({ helper, send, notify, invalidate, unavailable = () => false }) {
  let source, fingerprint, acceptedId, pending, stored = false, sequence = 0, busy = false, locked = false, stopped = false;
  const status = () => ({ present: !!source || stored, ready: !!fingerprint && !busy && !locked && !stopped,
    busy, locked, available: !stopped });
  const publish = message => { const value = { ...status(), message }; notify(value); return value; };
  const allowed = () => !stopped && !locked && !busy && !unavailable();
  function request(bytes) {
    if (pending || stopped) return Promise.reject(new Error('PROFILE_UNAVAILABLE'));
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending = undefined; reject(new Error('PROFILE_TIMEOUT')); }, 10000);
      pending = { id, resolve, reject, timer };
      send(bytes ? `UI_PROFILE ${id} ${bytes.toString('hex')}` : `UI_PROFILE_CLEAR ${id}`);
    });
  }
  function reply(parts) {
    if (!pending || parts[1] !== pending.id) throw new Error('PROFILE_PROTOCOL');
    const current = pending; pending = undefined; clearTimeout(current.timer);
    if (parts[0] === 'PROFILE_ACCEPTED' && parts.length === 3 && /^[A-F0-9]{64}$/.test(parts[2]))
      current.resolve({ id: parts[1], fingerprint: parts[2] });
    else if (parts[0] === 'PROFILE_CLEARED' && parts.length === 2) current.resolve({});
    else if (parts[0] === 'PROFILE_REJECTED' && parts.length === 2) current.reject(new Error('PROFILE_REJECTED'));
    else { current.reject(new Error('PROFILE_PROTOCOL')); throw new Error('PROFILE_PROTOCOL'); }
  }
  async function change(bytes, persist) {
    if (!allowed()) throw new Error('PROFILE_BUSY');
    busy = true; invalidate(); publish();
    try {
      const result = await request(bytes);
      try { if (persist) { if (bytes) await helper.saveProfile(bytes); else await helper.forgetProfile(); } }
      catch (error) {
        // Une écriture ratée ne doit pas laisser le contrôleur sur le nouveau profil.
        const restored = await request(source);
        fingerprint = restored.fingerprint; acceptedId = restored.id;
        throw error;
      }
      if (stopped) throw new Error('PROFILE_STOPPED');
      source?.fill(0); source = bytes ? Buffer.from(bytes) : undefined;
      stored = !!bytes;
      fingerprint = result.fingerprint; acceptedId = result.id;
      busy = false; return publish(bytes ? 'READY' : 'EMPTY');
    } catch (error) {
      busy = false;
      if (error.message !== 'PROFILE_REJECTED') { fingerprint = undefined; acceptedId = undefined; }
      return publish(error.message === 'PROFILE_REJECTED' ? 'INVALID' : 'ERROR');
    } finally { bytes?.fill(0); }
  }
  async function load() {
    try { return await change(await helper.readProfile(), false); }
    catch { stored = true; return publish('ERROR'); }
  }
  async function importFile(file) {
    if (!allowed()) throw new Error('PROFILE_BUSY');
    // Lecture bornée avant allocation ; les liens sont refusés, le handle reste
    // ouvert pendant la lecture pour éviter une seconde résolution du chemin.
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size >= 65536 || !info.size) return publish('INVALID');
    const handle = await fs.open(file, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size >= 65536 || !stat.size) return publish('INVALID');
      const bytes = Buffer.alloc(65536);
      try {
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (!bytesRead || bytesRead >= 65536) return publish('INVALID');
        return await change(Buffer.from(bytes.subarray(0, bytesRead)), true);
      } finally { bytes.fill(0); }
    } finally { await handle.close(); }
  }
  function start() {
    if (!allowed() || !fingerprint || !acceptedId) throw new Error('PROFILE_REQUIRED');
    locked = true; invalidate();
    send(`UI_PROFILE_START ${acceptedId}`); publish();
    return fingerprint;
  }
  function stop() {
    stopped = true; fingerprint = undefined; source?.fill(0); source = undefined;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error('PROFILE_STOPPED')); pending = undefined; }
  }
  return { status, reply, load, importFile, remove: () => change(null, true), start, stop,
    fingerprint: () => fingerprint, canChange: allowed };
}

function registerProfileIPC(ipcMain, { trusted, profile, selectFile }) {
  ipcMain.handle('myneige:profile-status', event => { if (!trusted(event)) throw new Error('Action refusée.'); return profile.status(); });
  let selecting = false;
  ipcMain.handle('myneige:profile-import', async event => {
    if (!trusted(event) || selecting || !profile.canChange()) throw new Error('Action refusée.');
    selecting = true;
    try {
      const file = await selectFile();
      if (!file) return profile.status();
      if (!trusted(event)) throw new Error('Action refusée.');
      return await profile.importFile(file);
    } finally { selecting = false; }
  });
  ipcMain.handle('myneige:profile-delete', event => {
    if (!trusted(event) || selecting) throw new Error('Action refusée.');
    return profile.remove();
  });
}
module.exports = { createVpnProfile, registerProfileIPC };
