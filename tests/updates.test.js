'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { parseVersion, parseDownload, createUpdateService } = require('../src/main/updates');

async function fixture(t, candidate = { version: '1.0.2-alpha.1', revision: 2 }, options = {}) {
  const base = path.resolve(__dirname, '../.local'); await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'myneige-updates-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const preferenceFile = path.join(directory, 'preferences.json');
  const calls = [], offers = [], opened = [];
  const transport = { get: async flag => {
    calls.push(flag);
    if (options.fail) throw new Error('Hors ligne');
    return flag === 'version' ? JSON.stringify(candidate) : (options.link || 'https://my-neige.42web.io/download');
  }, stop() { calls.push('stop'); } };
  const service = createUpdateService({ installed: { version: '1.0.1-alpha.1', revision: 1 }, preferenceFile,
    transport, notify: value => offers.push(value), openExternal: async url => opened.push(url) });
  return { service, preferenceFile, transport, offers, opened, calls };
}

test('contrat JSON : version et révision entière obligatoires, sans déduire une révision de SemVer', () => {
  assert.deepEqual(parseVersion('{"version":"1.0.1-alpha.1","revision":1}'), { version: '1.0.1-alpha.1', revision: 1 });
  for (const value of [null, {}, { version: '2.0.0', revision: '2' }, { version: '2.0.0', revision: 0 },
    { version: '<script>', revision: 2 }, { version: '2.0.0', revision: 1.5 }])
    assert.throws(() => parseVersion(JSON.stringify(value)));
  assert.throws(() => parseVersion('<html>API indisponible</html>'));
});
test('proposition uniquement si la version diffère ET la révision est supérieure', async t => {
  for (const candidate of [{ version: '1.0.1-alpha.1', revision: 2 }, { version: '2.0.0', revision: 1 },
    { version: '2.0.0', revision: 0 }]) {
    const f = await fixture(t, candidate); await f.service.check(); assert.equal(f.offers.length, 0);
  }
  const f = await fixture(t); await f.service.check(); await f.service.check();
  assert.equal(f.offers.length, 1); assert.deepEqual(f.calls, ['version']);
});
test('plus tard : fermeture pour ce lancement et nouvelle proposition au prochain lancement', async t => {
  const f = await fixture(t); await f.service.check();
  assert.deepEqual(await f.service.action('later'), { ok: true, remind: false });
  assert.deepEqual(await f.service.action('download'), { ok: false });
  await assert.rejects(fs.readFile(f.preferenceFile), { code: 'ENOENT' });
  const offers = [];
  await createUpdateService({ installed: { version: '1.0.1-alpha.1', revision: 1 },
    preferenceFile: f.preferenceFile, transport: f.transport, notify: value => offers.push(value) }).check();
  assert.equal(offers.length, 1);
});
test('refus définitif persistant, y compris pour une révision future', async t => {
  const f = await fixture(t); await f.service.check();
  assert.deepEqual(await f.service.action('never'), { ok: true, remind: true });
  assert.deepEqual(JSON.parse(await fs.readFile(f.preferenceFile)), { disabled: true });
  const offers = [];
  await createUpdateService({ installed: { version: '1.0.1-alpha.1', revision: 1 },
    preferenceFile: f.preferenceFile, transport: { get() { throw new Error('Ne doit pas appeler l’API'); } },
    notify: value => offers.push(value) }).check();
  assert.equal(offers.length, 0);
});
test('goto consulté uniquement au clic, ouverture externe et actions concurrentes refusées', async t => {
  const f = await fixture(t); await f.service.check();
  const first = f.service.action('download');
  assert.deepEqual(await f.service.action('never'), { ok: false });
  assert.deepEqual(await first, { ok: true, remind: false });
  assert.deepEqual(f.calls, ['version', 'goto']);
  assert.deepEqual(f.opened, ['https://my-neige.42web.io/download']);
});
test('liens goto : HTTPS externe seulement, texte brut ou JSON', () => {
  assert.equal(parseDownload(' https://my-neige.42web.io/download\n'), 'https://my-neige.42web.io/download');
  assert.equal(parseDownload('{"url":"https://example.org/setup.exe"}'), 'https://example.org/setup.exe');
  for (const value of ['http://example.org', 'file:///C:/test.exe', 'javascript:alert(1)', '<html>challenge</html>',
    'https://user:password@example.org/', 'https://cas.univ-avignon.fr/', '{}']) assert.throws(() => parseDownload(value));
});
test('panne API et lien invalide : aucun plantage, possibilité de reporter', async t => {
  const failed = await fixture(t, undefined, { fail: true }); await failed.service.check();
  assert.equal(failed.offers.length, 0);
  const f = await fixture(t, undefined, { link: 'file:///C:/evil.exe' }); await f.service.check();
  assert.deepEqual(await f.service.action('download'), { ok: false }); assert.equal(f.opened.length, 0);
  assert.equal((await f.service.action('later')).ok, true);
});
test('arrêt pendant goto : aucun lien ouvert après la perte de session', async t => {
  const f = await fixture(t); await f.service.check();
  let resolve;
  f.transport.get = () => new Promise(done => { resolve = done; });
  const pending = f.service.action('download'); f.service.stop(); resolve('https://example.org/setup.exe');
  assert.deepEqual(await pending, { ok: false }); assert.equal(f.opened.length, 0);
});
test('vérification manuelle répétable après un report ou une désactivation sans réactiver les rappels', async t => {
  const f = await fixture(t); await f.service.check(); await f.service.action('later');
  assert.equal((await f.service.check({ manual: true })).status, 'available');
  await f.service.action('never');
  assert.equal((await f.service.check({ manual: true })).status, 'available');
  assert.deepEqual(JSON.parse(await fs.readFile(f.preferenceFile)), { disabled: true });
  assert.equal(f.offers.length, 3);
});
test('vérification manuelle : résultats à jour et erreur distingués, nouvelle tentative possible', async t => {
  const f = await fixture(t, { version: '1.0.1-alpha.1', revision: 1 });
  assert.equal((await f.service.check({ manual: true })).status, 'current');
  f.transport.get = async () => { throw new Error('API indisponible'); };
  assert.equal((await f.service.check({ manual: true })).status, 'error');
  f.transport.get = async () => '{"version":"1.0.2-alpha.1","revision":2}';
  assert.equal((await f.service.check({ manual: true })).status, 'available');
});
test('clics manuels concurrents : un seul appel API et aucune proposition après arrêt', async t => {
  const f = await fixture(t); let resolve;
  f.transport.get = () => new Promise(done => { resolve = done; });
  const pending = f.service.check({ manual: true });
  assert.equal((await f.service.check({ manual: true })).status, 'busy');
  f.service.stop(); resolve('{"version":"1.0.2-alpha.1","revision":2}');
  assert.equal((await pending).status, 'stopped'); assert.equal(f.offers.length, 0);
});
