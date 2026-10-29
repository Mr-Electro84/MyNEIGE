'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
test('les seuls profils versionnés présents sont des fixtures explicitement fictives', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0');
  for (const file of files) {
    if (!/\.(ovpn|dpapi)$/i.test(file) || !fs.existsSync(path.join(root, file))) continue;
    assert.equal(file, 'tests/fixtures/synthetic.ovpn');
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /remote vpn\.example\.test /);
  }
});
test('le code et les lanceurs ne contiennent pas de serveur VPN universitaire imposé', () => {
  for (const dir of ['native', 'scripts', 'src']) {
    for (const file of fs.readdirSync(path.join(root, dir), { recursive: true })) {
      const target = path.join(root, dir, file);
      if (!fs.statSync(target).isFile()) continue;
      const source = fs.readFileSync(target, 'utf8');
      assert.doesNotMatch(source, /remote[^\r\n]*\buniv-[a-z-]+\.fr/i, target);
      assert.doesNotMatch(source, /VPN_Universite_[\w-]+\.ovpn/i, target);
    }
  }
});
