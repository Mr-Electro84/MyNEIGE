'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createVpnProfile, registerProfileIPC } = require('../src/main/vpn-profile');
const fingerprint = 'A'.repeat(64), otherFingerprint = 'B'.repeat(64);
function fixture({ saved = null, failSave = false } = {}) {
  const frames = [], states = []; let invalidations = 0, rejected = false, model;
  const helper = {
    readProfile: async () => saved && Buffer.from(saved),
    saveProfile: async bytes => { if (failSave) throw new Error('disk'); saved = Buffer.from(bytes); },
    forgetProfile: async () => { saved = null; }
  };
  model = createVpnProfile({ helper, send: frame => {
    frames.push(frame); const [verb, id] = frame.split(' ');
    if (verb === 'UI_PROFILE_START') return;
    setImmediate(() => model.reply(verb === 'UI_PROFILE_CLEAR' ? ['PROFILE_CLEARED', id] :
      rejected ? ['PROFILE_REJECTED', id] : ['PROFILE_ACCEPTED', id, frames.length > 2 ? otherFingerprint : fingerprint]));
  }, notify: state => states.push(state), invalidate: () => ++invalidations });
  return { model, frames, states, saved: () => saved, invalidations: () => invalidations, reject: () => { rejected = true; } };
}
test('premier lancement sans profil : connexion refusée, aucun secret ni chemin transmis', async () => {
  const f = fixture(); await f.model.load();
  assert.equal(f.model.status().ready, false); assert.throws(() => f.model.start(), /PROFILE_REQUIRED/);
  assert.deepEqual(f.frames, ['UI_PROFILE_CLEAR 1']);
});
test('import, persistance et relancement utilisent uniquement une copie privée', async () => {
  const file = path.resolve(__dirname, 'fixtures/synthetic.ovpn');
  const original = await fs.readFile(file), f = fixture();
  assert.equal((await f.model.importFile(file)).ready, true);
  assert.deepEqual(f.saved(), original); assert.deepEqual(await fs.readFile(file), original);
  const second = fixture({ saved: f.saved() }); await second.model.load();
  assert.equal(second.model.status().ready, true);
  assert.equal(second.model.start(), fingerprint);
  assert.equal(second.model.status().locked, true);
  await assert.rejects(second.model.remove(), /PROFILE_BUSY/);
  await assert.rejects(second.model.importFile(file), /PROFILE_BUSY/);
  assert.equal(second.invalidations(), 2);
});
test('un profil invalide conserve la copie précédente et son autorisation', async () => {
  const f = fixture({ saved: Buffer.from('ancien') }); await f.model.load(); f.reject();
  const result = await f.model.importFile(path.resolve(__dirname, 'fixtures/synthetic.ovpn'));
  assert.equal(result.message, 'INVALID'); assert.equal(result.ready, true);
  assert.equal(f.saved().toString(), 'ancien'); assert.equal(f.model.fingerprint(), fingerprint);
});
test('échec de stockage : restaurer le contrôleur, bloquer la connexion et conserver le disque', async () => {
  const f = fixture({ saved: Buffer.from('ancien'), failSave: true }); await f.model.load();
  assert.equal((await f.model.importFile(path.resolve(__dirname, 'fixtures/synthetic.ovpn'))).message, 'ERROR');
  assert.equal(f.saved().toString(), 'ancien'); assert.equal(f.model.status().ready, false);
  assert.equal(f.frames.length, 3); assert.match(f.frames[2], /616e6369656e$/);
});
test('suppression sans toucher au fichier d’origine, puis blocage après arrêt', async () => {
  const f = fixture({ saved: Buffer.from('ancien') }); await f.model.load();
  assert.equal((await f.model.remove()).present, false); assert.equal(f.saved(), null);
  f.model.stop(); assert.throws(() => f.model.start()); await assert.rejects(f.model.remove());
});
test('IPC réservé au formulaire et annulation du sélecteur sans modification', async () => {
  const handlers = new Map(), f = fixture(); let selected = 0;
  registerProfileIPC({ handle: (name, handler) => handlers.set(name, handler) }, {
    trusted: event => event === 'local', profile: f.model, selectFile: async () => { ++selected; return undefined; }
  });
  for (const [name, handler] of handlers) {
    if (name.endsWith('import')) await assert.rejects(handler('distant'));
    else assert.throws(() => handler('distant'));
  }
  await handlers.get('myneige:profile-import')('local');
  assert.equal(selected, 1); assert.equal(f.frames.length, 0);
});
test('acquittements périmés refusés et contenu public limité aux indicateurs', async () => {
  const f = fixture(); assert.throws(() => f.model.reply(['PROFILE_ACCEPTED', '999', fingerprint]));
  await f.model.load();
  assert.deepEqual(Object.keys(f.model.status()).sort(), ['available', 'busy', 'locked', 'present', 'ready']);
});
test('un profil chiffré illisible reste supprimable sans activer la connexion', async () => {
  let deleted = false, model;
  model = createVpnProfile({ helper: { readProfile: async () => { throw new Error('corrupt'); },
    forgetProfile: async () => { deleted = true; } }, invalidate: () => {}, notify: () => {},
    send: frame => { const [, id] = frame.split(' '); setImmediate(() => model.reply(['PROFILE_CLEARED', id])); } });
  assert.equal((await model.load()).message, 'ERROR');
  assert.equal(model.status().present, true); assert.equal(model.status().ready, false);
  await model.remove(); assert.equal(deleted, true); assert.equal(model.status().present, false);
});
test('arrêt pendant validation et demandes concurrentes restent bloquants', async () => {
  const model = createVpnProfile({ helper: { readProfile: async () => Buffer.from('fixture') },
    invalidate: () => {}, notify: () => {}, send: () => {} });
  const loading = model.load(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(model.status().busy, true); await assert.rejects(model.remove(), /PROFILE_BUSY/);
  model.stop(); await loading;
  assert.equal(model.status().ready, false); assert.equal(model.status().available, false);
});
