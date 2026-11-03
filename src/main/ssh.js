'use strict';
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { validateCredentials } = require('./policy');

const SSH_HOST = 'pedago.univ-avignon.fr';
const SSH_PORT = 22;
const HIGH_WATER = 128 * 1024;
function sshProxyAuthorization(secret) {
  if (!/^[a-f0-9]{64}$/.test(secret || '')) throw new Error('SSH_PROXY');
  const capability = createHash('sha256').update('MyNEIGE SSH v1\n' + secret).digest('hex');
  return 'Basic ' + Buffer.from('myneige-ssh:' + capability).toString('base64');
}

// Seule l'adresse numérique locale est résolue par Node. Le relais résout la cible via le VPN.
function connectSshProxy({ port, secret, signal, connect = net.createConnection }) {
  return new Promise((resolve, reject) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || signal?.aborted) { reject(new Error('SSH_PROXY')); return; }
    let authorization;
    try { authorization = sshProxyAuthorization(secret); } catch { reject(new Error('SSH_PROXY')); return; }
    const socket = connect({ host: '127.0.0.1', port });
    let header = Buffer.alloc(0), settled = false;
    const cleanup = () => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      socket.removeListener('data', data); socket.removeListener('error', fail); socket.removeListener('close', fail);
    };
    const fail = () => {
      if (settled) return; settled = true; cleanup(); socket.destroy(); reject(new Error('SSH_PROXY'));
    };
    const abort = () => fail();
    const timer = setTimeout(fail, 15000);
    const data = chunk => {
      header = Buffer.concat([header, chunk]);
      const end = header.indexOf('\r\n\r\n');
      if (end < 0) { if (header.length > 16384) fail(); return; }
      if (end > 16380 || !/^HTTP\/1\.[01] 200(?: |\r\n)/.test(header.subarray(0, end + 2).toString('latin1'))) { fail(); return; }
      settled = true; socket.pause(); cleanup();
      // Une bannière SSH peut suivre la réponse CONNECT dans le même paquet.
      if (header.length > end + 4) socket.unshift(header.subarray(end + 4));
      header = undefined; resolve(socket);
    };
    signal?.addEventListener('abort', abort, { once: true });
    socket.once('error', fail); socket.once('close', fail); socket.on('data', data);
    socket.once('connect', () => {
      if (settled) return;
      socket.write(`CONNECT ${SSH_HOST}:${SSH_PORT} HTTP/1.1\r\nHost: ${SSH_HOST}:${SSH_PORT}\r\nProxy-Authorization: ${authorization}\r\n\r\n`);
      authorization = undefined;
    });
  });
}

// Première confiance explicite, puis refus d'une clé modifiée. Aucun mot de passe dans ce fichier.
function createHostVerifier({ file, confirm, ready }) {
  return async key => {
    if (!ready() || !Buffer.isBuffer(key) || key.length > 16384) return false;
    const fingerprint = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
    let known;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return false;
      known = JSON.parse(await fs.readFile(file, 'utf8'));
      if (known.host !== SSH_HOST || known.port !== SSH_PORT || typeof known.fingerprint !== 'string') return false;
    } catch (error) { if (error.code !== 'ENOENT') return false; }
    if (known) {
      if (known.fingerprint !== fingerprint) throw new Error('SSH_HOST_CHANGED');
      return ready();
    }
    if (!ready() || !await confirm(fingerprint) || !ready()) return false;
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.' + randomBytes(8).toString('hex') + '.tmp';
    try {
      await fs.writeFile(temporary, JSON.stringify({ host: SSH_HOST, port: SSH_PORT, fingerprint }) + '\n', { flag: 'wx', mode: 0o600 });
      if (!ready()) return false;
      await fs.rename(temporary, file);
      return ready();
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  };
}

function terminalSize(value) {
  return value && Number.isInteger(value.cols) && Number.isInteger(value.rows) &&
    value.cols >= 2 && value.cols <= 500 && value.rows >= 1 && value.rows <= 300;
}

function createSshConnection({ port, secret, ready, verifyHost, onData, onState,
  clientFactory = () => new (require('ssh2').Client)(), connectProxy = connectSshProxy }) {
  let client, socket, stream, stopped = false, connected = false, pending = 0, inputPending = 0, authAttempted = false;
  let size = { cols: 100, rows: 30 }, keyboardAnswered = false;
  const controller = new AbortController();
  const clearPassword = () => { if (client?.config) client.config.password = undefined; };
  function stop() {
    if (stopped) return;
    stopped = true; connected = false; controller.abort(); clearPassword();
    stream?.destroy(); client?.destroy(); socket?.destroy(); pending = inputPending = 0;
  }
  function finish(state) {
    if (stopped) return;
    stop(); onState(state);
  }
  return {
    async start(credentials) {
      if (stopped || client || !ready() || !validateCredentials(credentials)) {
        if (credentials) credentials.username = credentials.password = '';
        finish('error'); return;
      }
      try {
        onState('connecting');
        socket = await connectProxy({ port, secret, signal: controller.signal });
        if (stopped || !ready()) { socket.destroy(); stop(); return; }
        client = clientFactory();
        // Tout événement d'erreur est absorbé ici ; aucun détail du protocole n'est journalisé.
        client.on('error', error => finish(error.level === 'client-authentication' ? 'authentication-failed' : 'error'));
        client.on('close', () => finish('closed'));
        client.on('keyboard-interactive', (_name, _instructions, _language, prompts, answer) => {
          // PAM peut annoncer un mot de passe comme « keyboard-interactive ».
          // Ne pas envoyer ce secret à un prompt OTP, à un champ visible ou à plusieurs questions.
          if (stopped || !ready() || keyboardAnswered || prompts.length !== 1 || prompts[0].echo ||
              !/password|mot de passe/i.test(prompts[0].prompt) || typeof client.config.password !== 'string') {
            answer([]); return;
          }
          keyboardAnswered = true; answer([client.config.password]);
        });
        client.on('ready', () => {
          clearPassword();
          if (stopped || !ready()) { stop(); return; }
          client.shell({ term: 'xterm-256color', cols: size.cols, rows: size.rows }, (error, channel) => {
            if (stopped || !ready()) { channel?.destroy(); stop(); return; }
            if (error) { finish('error'); return; }
            stream = channel; connected = true; onState('connected');
            channel.on('error', () => finish('error'));
            channel.on('close', () => finish('closed'));
            channel.on('data', chunk => {
              if (stopped || !ready()) { stop(); return; }
              pending += chunk.length;
              if (pending > HIGH_WATER) channel.pause();
              // Les acquittements du renderer bornent la file IPC et la mémoire de xterm.
              if (pending > 4 * HIGH_WATER) { finish('error'); return; }
              onData(chunk);
            });
          });
        });
        client.connect({ sock: socket, host: SSH_HOST, port: SSH_PORT, username: credentials.username,
          password: credentials.password, tryKeyboard: true,
          authHandler: (methods, _partial, next) => {
            if (!methods) { next('none'); return; }
            if (authAttempted || stopped || !ready()) { next(false); return; }
            const method = methods.includes('password') ? 'password' : methods.includes('keyboard-interactive') ? 'keyboard-interactive' : false;
            authAttempted = true; next(method);
          },
          keepaliveInterval: 10000, keepaliveCountMax: 3, readyTimeout: 150000,
          hostVerifier: (key, callback) => {
            Promise.resolve().then(() => stopped || !ready() ? false : verifyHost(key)).then(
              accepted => callback(!stopped && ready() && accepted === true),
              error => { if (error.message === 'SSH_HOST_CHANGED') finish('host-changed'); callback(false); }
            ).catch(() => finish('error'));
          } });
        socket.resume();
      } catch { finish('error'); }
      finally { credentials.username = credentials.password = ''; }
    },
    input(value) {
      if (stopped || !connected || !ready() || typeof value !== 'string' || !value.length) return;
      const bytes = Buffer.byteLength(value, 'utf8');
      if (bytes > 65536 || inputPending + bytes > HIGH_WATER) { finish('input-overflow'); return; }
      inputPending += bytes;
      try { stream.write(value, () => { inputPending = Math.max(0, inputPending - bytes); }); }
      catch { finish('error'); }
    },
    resize(value) {
      if (stopped || !ready() || !terminalSize(value)) return;
      size = { cols: value.cols, rows: value.rows };
      if (connected) { try { stream.setWindow(size.rows, size.cols, 0, 0); } catch { finish('error'); } }
    },
    acknowledge(bytes) {
      if (stopped || !Number.isInteger(bytes) || bytes <= 0 || bytes > pending) return;
      pending -= bytes;
      if (pending < HIGH_WATER / 2 && ready()) stream?.resume();
    },
    stop
  };
}
module.exports = { SSH_HOST, SSH_PORT, sshProxyAuthorization, connectSshProxy, createHostVerifier, terminalSize, createSshConnection };
