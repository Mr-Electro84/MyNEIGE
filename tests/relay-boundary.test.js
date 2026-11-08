'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('les relais n’importent aucun module du contrôleur, du coffre ou des sondes', () => {
  const script = read('scripts/build-relays.ps1');
  const files = [...script.matchAll(/'(native\\windows\\(?:shared|relay)\\[^']+\.cpp)'/g)]
    .map(match => match[1].replaceAll('\\', '/'));
  assert(files.includes('native/windows/relay/worker.cpp'));
  assert(files.includes('native/windows/shared/network.cpp'));
  const seen = new Set();
  function visit(file) {
    const target = path.resolve(root, file);
    assert(['relay', 'shared'].some(dir => target.startsWith(path.join(root, 'native/windows', dir) + path.sep)), file);
    if (seen.has(target)) return;
    seen.add(target);
    const source = fs.readFileSync(target, 'utf8');
    assert.doesNotMatch(source, /\b(?:Fwpm\w*|CreateProcess\w*|ShellExecute\w*|CopyFile\w*|CreateRestrictedToken|DuplicateTokenEx|SetSecurityInfo|CreateIpForwardEntry2|DeleteIpForwardEntry2|CryptProtectData|CryptUnprotectData)\s*\(/, file);
    for (const match of source.matchAll(/#include\s*"([^"]+)"/g)) {
      visit(path.relative(root, path.resolve(path.dirname(target), match[1])));
    }
  }
  files.forEach(visit);
});

test('les binaires de relais ont des rôles fixes et le staging refuse les copies du contrôleur', () => {
  const main = read('native/windows/poc/main.cpp');
  assert.doesNotMatch(main, /relay-worker|public-relay-worker|security-probe|runtime-cache-probe|blocked-probe/);
  const platform = read('native/windows/poc/platform.cpp');
  assert.doesNotMatch(platform, /CopyFileW\(imagePath\(\)/);
  assert.match(platform, /expected != sha256File\(imagePath\(\)\)/);
  assert.match(platform, /sha256File\(destination\) == expected/);
  assert.match(read('scripts/build-relays.ps1'), /DMYNEIGE_PUBLIC_RELAY=0/);
  assert.match(read('scripts/build-relays.ps1'), /DMYNEIGE_PUBLIC_RELAY=1/);
  assert.doesNotMatch(read('native/windows/poc/public-routing.cpp'), /CopyFileW/);
});

test('les deux relais sont requis par les manifestes et les sondes restent hors distribution', () => {
  for (const file of ['native/windows/poc/startup.cpp', 'scripts/distribution-common.ps1', 'scripts/test-profile-packaging.ps1']) {
    const source = read(file);
    assert.match(source, /bin\/myneige-relay\.exe/, file);
    assert.match(source, /bin\/myneige-public-relay\.exe/, file);
    assert.doesNotMatch(source, /bin\/myneige-probe\.exe/, file);
  }
  const build = read('scripts/build-distribution.ps1');
  assert.match(build, /myneige-relay\.exe/);
  assert.match(build, /myneige-public-relay\.exe/);
  assert.doesNotMatch(build, /myneige-probe\.exe/);
});
