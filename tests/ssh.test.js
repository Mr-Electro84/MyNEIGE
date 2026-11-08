'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Server, utils } = require('ssh2');
const { SSH_HOST, sshProxyAuthorization, connectSshProxy, createHostVerifier, createSshConnection, terminalSize } = require('../src/main/ssh');
const { acquireSshCredentials } = require('../src/main/ssh-window');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition) {
  for (let i = 0; i < 250; i++) { if (condition()) return; await pause(20); }
  throw new Error('Événement SSH local absent');
}
const secret = 'a'.repeat(64);
async function directory(t) {
  const base = path.resolve(__dirname, '../.local'); await fs.mkdir(base, { recursive: true });
  const target = await fs.mkdtemp(path.join(base, 'ssh-tests-'));
  assert(target.startsWith(base + path.sep));
  t.after(() => fs.rm(target, { force: true, recursive: true })); return target;
}

test('SSH : Hello avec coffre, saisie si indisponible ou sans enregistrement, annulation respectée', async () => {
  let prompts = 0, unlocks = 0;
  const credentials = () => ({ username: 'compte-fictif', password: 'mot-de-passe-fictif' });
  const options = { handle: 42n, fingerprint: 'A'.repeat(64), current: () => true,
    prompt: async () => { ++prompts; return credentials(); },
    vault: { status: async () => ({ saved: true, hello: true }), unlock: async () => { ++unlocks; return credentials(); } } };
  assert.deepEqual(await acquireSshCredentials(options), credentials()); assert.equal(prompts, 0); assert.equal(unlocks, 1);
  options.vault.unlock = async () => null;
  assert.equal(await acquireSshCredentials(options), null); assert.equal(prompts, 0);
  options.vault.status = async () => ({ saved: true, hello: false });
  assert.deepEqual(await acquireSshCredentials(options), credentials()); assert.equal(prompts, 1);
  options.vault.status = async () => ({ saved: false, hello: true });
  await acquireSshCredentials(options); assert.equal(prompts, 2);
  options.vault.status = async () => ({ saved: true, hello: true });
  options.vault.unlock = async () => { throw new Error('UNAVAILABLE'); };
  await acquireSshCredentials(options); assert.equal(prompts, 3);
  options.vault.status = async () => { throw new Error('Ne doit pas être appelé'); };
  await acquireSshCredentials({ ...options, manual: true }); assert.equal(prompts, 4);
});

test('SSH : suppression/fermeture pendant Hello efface les identifiants tardifs', async () => {
  let active = true, resolve;
  const result = acquireSshCredentials({ handle: 42n, fingerprint: 'A'.repeat(64), current: () => active,
    prompt: () => { throw new Error('Dialogue inattendu'); },
    vault: { status: async () => ({ saved: true, hello: true }), unlock: () => new Promise(done => { resolve = done; }) } });
  await until(() => resolve); active = false;
  const credentials = { username: 'fictif', password: 'secret-fictif' }; resolve(credentials);
  assert.equal(await result, null); assert.deepEqual(credentials, { username: '', password: '' });
});

test('SSH : première confiance explicite, empreinte mémorisée, refus de remplacement et annulation', async t => {
  const file = path.join(await directory(t), 'host.json');
  let confirmations = 0, active = true;
  const verify = createHostVerifier({ file, ready: () => active, confirm: async fp => {
    assert.match(fp, /^SHA256:[A-Za-z0-9+/]{43}$/); ++confirmations; return true;
  } });
  assert(await verify(Buffer.from('cle-fictive'))); assert.equal(confirmations, 1);
  assert(await verify(Buffer.from('cle-fictive'))); assert.equal(confirmations, 1);
  await assert.rejects(verify(Buffer.from('autre-cle')), /SSH_HOST_CHANGED/);
  active = false; assert.equal(await verify(Buffer.from('cle-fictive')), false);
  const other = path.join(path.dirname(file), 'cancelled.json');
  assert.equal(await createHostVerifier({ file: other, ready: () => true, confirm: async () => false })(Buffer.from('cle')), false);
  await assert.rejects(fs.stat(other), { code: 'ENOENT' });
  await fs.writeFile(file, '{}'); active = true;
  assert.equal(await verify(Buffer.from('cle-fictive')), false); assert.equal(confirmations, 1);
});

test('SSH : protocole proxy distinct et dimensions bornées', () => {
  assert.equal(sshProxyAuthorization(secret), 'Basic bXluZWlnZS1zc2g6NzljZTM4MTdlNzlhM2U5ZjcxMzJiNjI1NjNmYjdmYjk1ODBiNjg1MmFiZjI4ODMyMTQ5MjQ0MzMxOTEwOTBkZQ==');
  assert.throws(() => sshProxyAuthorization('bad\r\n'));
  assert(terminalSize({ cols: 80, rows: 24 }));
  for (const value of [null, { cols: 0, rows: 24 }, { cols: 501, rows: 24 }, { cols: 80, rows: 301 }, { cols: '80', rows: 24 }]) assert(!terminalSize(value));
});

async function fakeProxy(t, reply) {
  const sockets = new Set(); let header = '';
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    socket.on('data', bytes => { header += bytes; if (header.includes('\r\n\r\n')) reply(socket); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  return { port: server.address().port, header: () => header };
}
test('SSH : refus CONNECT, fermeture précoce et abandon ne provoquent aucun secours direct', async t => {
  for (const reply of [socket => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'), socket => socket.destroy(), socket => socket.write('X'.repeat(17000))]) {
    const f = await fakeProxy(t, reply);
    await assert.rejects(connectSshProxy({ port: f.port, secret }), /SSH_PROXY/);
    assert.match(f.header(), /^CONNECT pedago\.univ-avignon\.fr:22 HTTP\/1\.1/);
    assert(f.header().includes(sshProxyAuthorization(secret)));
  }
  const f = await fakeProxy(t, () => {}), controller = new AbortController();
  const pending = connectSshProxy({ port: f.port, secret, signal: controller.signal }); controller.abort();
  await assert.rejects(pending, /SSH_PROXY/);
});

for (const method of ['password', 'keyboard-interactive']) test(`SSH réel local (${method}) : pseudo-terminal, Unicode, Ctrl+C, redimensionnement et arrêt`, async t => {
  const hostKey = utils.generateKeyPairSync('rsa', { bits: 2048 }).private;
  let authentications = 0, pty, resized, received = '';
  const peers = new Set();
  const server = new Server({ hostKeys: [hostKey] }, peer => {
    peers.add(peer); peer.on('error', () => {}); peer.on('close', () => peers.delete(peer));
    peer.on('authentication', ctx => {
      if (ctx.method !== method || ctx.username !== 'fictif') { ctx.reject([method]); return; }
      ++authentications;
      if (method === 'password') {
        ctx.password === 'secret-fictif' ? ctx.accept() : ctx.reject([method]);
      } else ctx.prompt([{ prompt: 'Password: ', echo: false }], answers => {
        answers[0] === 'secret-fictif' ? ctx.accept() : ctx.reject([method]);
      });
    });
    peer.on('ready', () => peer.on('session', accept => {
      const session = accept();
      session.on('pty', (accept, _reject, info) => { pty = info; accept(); });
      session.on('window-change', (accept, _reject, info) => { resized = info; accept?.(); });
      session.on('shell', accept => {
        const channel = accept(); channel.write('Bienvenue é\r\n');
        channel.on('data', bytes => { received += bytes.toString(); channel.write(bytes); });
      });
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const peer of peers) peer.end(); server.close(); });
  const backends = new Set();
  t.after(() => { for (const socket of backends) socket.destroy(); });
  const proxy = await fakeProxy(t, socket => {
    socket.removeAllListeners('data');
    const upstream = net.connect({ host: '127.0.0.1', port: server.address().port }, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); socket.pipe(upstream); upstream.pipe(socket);
    });
    backends.add(upstream); upstream.on('error', () => socket.destroy());
    socket.once('close', () => upstream.destroy());
  });
  const states = []; let output = '', active = true, connection;
  connection = createSshConnection({ port: proxy.port, secret, ready: () => active,
    verifyHost: async key => { assert(Buffer.isBuffer(key)); return true; },
    onState: value => states.push(value), onData: chunk => { output += chunk.toString(); connection.acknowledge(chunk.length); } });
  t.after(() => connection.stop());
  const credentials = { username: 'fictif', password: 'secret-fictif' };
  await connection.start(credentials); assert.deepEqual(credentials, { username: '', password: '' });
  await until(() => output.includes('Bienvenue é'));
  assert.equal(authentications, 1); assert.equal(pty.term, 'xterm-256color'); assert(states.includes('connected'));
  connection.resize({ cols: 120, rows: 40 }); await until(() => resized); assert.equal(resized.cols, 120);
  connection.input('printf été\r\x03'); await until(() => received.includes('\x03')); assert(received.includes('été'));
  active = false; connection.input('NE_PAS_ENVOYER'); await pause(50); assert(!received.includes('NE_PAS_ENVOYER'));
  connection.stop(); await until(() => peers.size === 0);
});

test('SSH : une clé refusée empêche toute authentification', async t => {
  const hostKey = utils.generateKeyPairSync('rsa', { bits: 2048 }).private;
  let authentications = 0;
  const peers = new Set();
  const server = new Server({ hostKeys: [hostKey] }, peer => {
    peers.add(peer); peer.on('error', () => {}); peer.on('close', () => peers.delete(peer)); peer.on('authentication', () => ++authentications);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const peer of peers) peer.end(); server.close(); });
  const states = [];
  const connection = createSshConnection({ ready: () => true, verifyHost: async () => false,
    connectProxy: async () => net.connect({ host: '127.0.0.1', port: server.address().port }),
    onData: () => {}, onState: state => states.push(state) });
  t.after(() => connection.stop());
  await connection.start({ username: 'fictif', password: 'secret-fictif' });
  await until(() => states.includes('error')); assert.equal(authentications, 0);
});

test('SSH : sortie abondante ralentie, acquittements contrôlés et entrée bornée', async () => {
  let client, channel;
  let pauses = 0, resumes = 0, stopped = false, writes = 0;
  const connection = createSshConnection({ ready: () => true, verifyHost: async () => true,
    connectProxy: async () => ({ resume() {}, destroy() {} }),
    clientFactory: () => {
      client = new EventEmitter(); client.config = {}; client.connect = () => {};
      client.destroy = () => { stopped = true; }; client.shell = (_size, callback) => {
        channel = new EventEmitter(); channel.destroy = () => {}; channel.pause = () => ++pauses; channel.resume = () => ++resumes;
        channel.write = () => { ++writes; }; callback(null, channel);
      }; return client;
    }, onData: () => {}, onState: () => {} });
  await connection.start({ username: 'fictif', password: 'secret-fictif' }); client.emit('ready');
  channel.emit('data', Buffer.alloc(140000)); assert.equal(pauses, 1);
  connection.acknowledge(999999); assert.equal(resumes, 0);
  connection.acknowledge(140000); assert.equal(resumes, 1);
  assert.equal(connection.input('x'.repeat(65537)), false); assert.equal(stopped, false);
  assert.equal(connection.input('ls\r'), true); assert.equal(writes, 1); connection.stop();
});
