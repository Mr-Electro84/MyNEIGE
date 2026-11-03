'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('le staging contient toutes les dépendances JavaScript obligatoires du terminal et leurs licences', () => {
  const root = path.resolve(__dirname, '..'), required = new Set();
  function visit(name) {
    if (required.has(name)) return;
    required.add(name);
    const directory = path.join(root, 'node_modules', name);
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(metadata.dependencies || {})) visit(dependency);
    assert(fs.readdirSync(directory).some(file => /^(licen[sc]e|unlicense|copying)/i.test(file)), 'Licence absente : ' + name);
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const name of Object.keys(metadata.dependencies)) visit(name);
  const staged = fs.readFileSync(path.join(root, 'src/runtime-dependencies.txt'), 'utf8').trim().split(/\r?\n/);
  for (const name of staged) assert.match(name, /^(@[a-z0-9-]+\/)?[a-z0-9-]+$/);
  assert.deepEqual(staged.sort(), [...required].sort());
});
