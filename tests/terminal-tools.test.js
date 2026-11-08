'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createTerminalTools, saveTerminalText, MAX_PASTE, MAX_TEXT } = require('../src/main/terminal-tools');
const { snapshot, searchTerm } = require('../src/renderer/terminal-buffer');

function fixture() {
  const calls = []; let active = true, connected = true, copied = '', pasted = 'texte fictif';
  let response = 1, selected = { canceled: false, filePath: 'D:\\export-fictif.txt' };
  const tools = createTerminalTools({
    clipboard: { readText: async () => { calls.push('read'); return pasted; }, writeText: async text => { copied = text; } },
    dialog: { showMessageBox: async (_owner, options) => { calls.push(options); return { response }; },
      showSaveDialog: async () => { calls.push('save-dialog'); return selected; } },
    save: async (file, text, current) => { calls.push({ file, text }); return current(); }
  });
  const context = { owner: {}, current: () => active, canPaste: () => connected };
  return { tools, context, calls, copied: () => copied, active: value => { active = value; }, connected: value => { connected = value; },
    pasted: value => { pasted = value; }, response: value => { response = value; }, selected: value => { selected = value; } };
}
test('copie UTF-8 et collage explicites : aucun accès au presse-papiers sans action valide', async () => {
  const f = fixture();
  assert((await f.tools('copy', 'été 🏔', f.context)).ok); assert.equal(f.copied(), 'été 🏔');
  assert.deepEqual(await f.tools('paste', undefined, f.context), { ok: true, text: 'texte fictif' });
  f.connected(false);
  assert.equal((await f.tools('paste', undefined, f.context)).reason, 'disconnected'); assert.deepEqual(f.calls, ['read']);
  f.active(false); assert.equal((await f.tools('copy', 'autre', f.context)).ok, false); assert.equal(f.copied(), 'été 🏔');
});
test('collage multiligne : confirmation, annulation, contrôles et taille bornée', async () => {
  const f = fixture(); f.pasted('ls\r\necho été\n');
  assert((await f.tools('paste', undefined, f.context)).ok);
  const confirmation = f.calls.find(call => typeof call === 'object');
  assert.equal(confirmation.defaultId, 0); assert.equal(confirmation.detail, 'ls\r\necho été\n');
  f.response(0); assert.equal((await f.tools('paste', undefined, f.context)).reason, 'cancelled');
  f.pasted('x'.repeat(MAX_PASTE + 1)); assert.equal((await f.tools('paste', undefined, f.context)).reason, 'paste-too-large');
  f.pasted('abc\x1b[201~'); assert.equal((await f.tools('paste', undefined, f.context)).reason, 'controls');
  f.pasted(''); assert.equal((await f.tools('paste', undefined, f.context)).reason, 'empty');
});
test('une déconnexion pendant un dialogue interdit le collage et l’export tardifs', async () => {
  let resolve, reads = 0, saves = 0, active = true;
  const tools = createTerminalTools({ clipboard: { readText: async () => { ++reads; return 'commande\n'; } },
    dialog: { showMessageBox: () => new Promise(done => { resolve = done; }),
      showSaveDialog: () => new Promise(done => { resolve = done; }) }, save: async () => { ++saves; return true; } });
  const context = { owner: {}, current: () => active, canPaste: () => active };
  const paste = tools('paste', undefined, context); await new Promise(done => setImmediate(done));
  assert.equal((await tools('paste', undefined, context)).ok, false); assert.equal(reads, 1);
  active = false; resolve({ response: 1 }); assert.equal((await paste).ok, false);
  active = true;
  const exporting = tools('export', 'sortie fictive', context); active = false;
  resolve({ canceled: false, filePath: 'D:\\export-fictif.txt' }); assert.equal((await exporting).ok, false); assert.equal(saves, 0);
});
test('export : uniquement le texte figé, choix explicite du fichier et erreurs génériques', async () => {
  const f = fixture(); assert((await f.tools('export', 'résultat\r\n', f.context)).ok);
  assert.deepEqual(f.calls.at(-1), { file: 'D:\\export-fictif.txt', text: 'résultat\r\n' });
  f.selected({ canceled: true }); assert.equal((await f.tools('export', 'texte', f.context)).reason, 'cancelled');
  f.selected({ canceled: false, filePath: 'D:\\export-fictif.exe' });
  assert.equal((await f.tools('export', 'texte', f.context)).reason, 'extension');
  assert.equal((await f.tools('export', 'x'.repeat(MAX_TEXT + 1), f.context)).reason, 'too-large');
  const broken = createTerminalTools({ clipboard: { readText: async () => { throw new Error('détail privé'); } }, dialog: {} });
  assert.deepEqual(await broken('paste', undefined, f.context), { ok: false, reason: 'error' });
});
test('sauvegarde UTF-8 : remplacement complet et abandon avant renommage', async t => {
  const base = path.resolve(__dirname, '../.local'); await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'terminal-export-'));
  assert(directory.startsWith(base + path.sep));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'sortie.txt'); await fs.writeFile(file, 'ancien');
  assert(await saveTerminalText(file, 'été 🏔\r\n', () => true)); assert.equal(await fs.readFile(file, 'utf8'), 'été 🏔\r\n');
  assert.equal(await saveTerminalText(file, 'nouveau', () => false), false);
  assert.equal(await fs.readFile(file, 'utf8'), 'été 🏔\r\n'); assert.deepEqual(await fs.readdir(directory), ['sortie.txt']);
});
test('export du tampon : lignes visuellement repliées, espaces, Unicode et lignes vides', () => {
  const lines = [
    { isWrapped: false, translateToString: trim => trim ? 'long' : 'long ' },
    { isWrapped: true, translateToString: () => 'texte é 🏔' },
    { isWrapped: false, translateToString: () => '' },
    { isWrapped: false, translateToString: () => 'fin' },
    { isWrapped: false, translateToString: () => '' }
  ];
  assert.equal(snapshot({ length: lines.length, getLine: index => lines[index] }), 'long texte é 🏔\r\n\r\nfin\r\n');
  assert.equal(snapshot({ length: 0, getLine: () => undefined }), '');
});
test('recherche de mots entiers : accents, métacaractères et correspondances après un mot partiel', () => {
  assert.deepEqual('alpha alphabet ALPHA alpha'.match(new RegExp(searchTerm('alpha', true), 'gi')), ['alpha', 'ALPHA', 'alpha']);
  assert.deepEqual('été étés (été)'.match(new RegExp(searchTerm('été', true), 'gi')), ['été', 'été']);
  assert.deepEqual('a+b aab (a+b)'.match(new RegExp(searchTerm('a+b', true), 'gi')), ['a+b', 'a+b']);
  assert.equal(searchTerm('texte', false), 'texte');
});
