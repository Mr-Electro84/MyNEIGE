'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('le coffre possède un graphe de sources local, sans code réseau ou création de processus', () => {
  const script = read('scripts/build-vault.ps1');
  const sources = [...script.matchAll(/'((?:native\\windows\\)[^']+\.cpp)'/g)].map(match => match[1].replaceAll('\\', '/'));
  assert.deepEqual(sources, ['native/windows/vault/main.cpp', 'native/windows/vault/vault.cpp',
    'native/windows/shared/hash.cpp', 'native/windows/shared/vpn-profile.cpp']);
  const seen = new Set();
  function visit(file) {
    const target = path.resolve(root, file);
    assert(target.startsWith(path.join(root, 'native/windows/vault') + path.sep) ||
      target.startsWith(path.join(root, 'native/windows/shared') + path.sep), 'Dépendance hors périmètre : ' + file);
    if (seen.has(target)) return; seen.add(target);
    const text = fs.readFileSync(target, 'utf8');
    assert.doesNotMatch(text, /\b(?:CreateProcess\w*|ShellExecute\w*|WSAStartup|socket|connectWithin|Fwpm\w*|WinHttp\w*)\s*\(/);
    assert.doesNotMatch(text, /#include\s*<(?:winsock2|ws2tcpip|fwpmu|winhttp|iphlpapi)\.h>/);
    for (const match of text.matchAll(/#include\s*"([^"]+)"/g)) visit(path.relative(root, path.resolve(path.dirname(target), match[1])));
  }
  for (const file of sources) visit(file);
  assert.doesNotMatch(script.split('$compilerArgs =')[1].split('$buildScript =')[0], /ws2_32\.lib|fwpuclnt\.lib|winhttp\.lib|iphlpapi\.lib/);
});

test('le staging exige le coffre dédié et le contrôleur ne possède aucun point d’entrée du coffre', () => {
  const browser = read('native/windows/poc/browser.cpp');
  assert.match(browser, /bin\/myneige-vault\.exe/); assert.match(browser, /\.local\/poc\/myneige-vault\.exe/);
  assert.match(browser, /CopyFileW\(vaultSource\.c_str\(\), vault\.c_str\(\), TRUE\)/);
  assert.doesNotMatch(browser, /CopyFileW\(imagePath\(\)\.c_str\(\), vault\.c_str\(\)/);
  assert.match(browser, /sha256File\(vaultSource\) != sha256File\(imagePath\(\)\)/);
  assert.doesNotMatch(read('native/windows/poc/main.cpp'), /vault-worker|vault-self-test|vault-forget/);
  assert(!fs.existsSync(path.join(root, 'native/windows/poc/vault.cpp')));
  assert.match(read('scripts/build-poc.ps1'), /build-vault\.ps1/);
});

test('les deux vérificateurs de manifeste exigent le coffre dédié', () => {
  for (const file of ['native/windows/poc/startup.cpp', 'scripts/distribution-common.ps1']) {
    assert.match(read(file), /bin\/myneige-vault\.exe/, file);
  }
  assert.match(read('scripts/build-distribution.ps1'), /bin\\myneige-vault\.exe/);
});
