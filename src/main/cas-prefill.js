'use strict';
const { START_URL, validateCredentials } = require('./policy');
const CAS_ORIGIN = 'https://cas.univ-avignon.fr';

function casEndpoint(value) {
  try {
    const url = new URL(value);
    return url.origin === CAS_ORIGIN && url.pathname === '/cas/login' && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
function casDocument(value) {
  if (!casEndpoint(value)) return false;
  const services = new URL(value).searchParams.getAll('service');
  if (services.length !== 1) return false;
  try {
    const service = new URL(services[0]);
    return service.origin === new URL(START_URL).origin && !service.username && !service.password && !service.hash;
  } catch { return false; }
}

class CasPrefill {
  constructor({ ready, report = () => {}, now = Date.now, ttl = 180000 }) {
    this.ready = ready; this.report = report; this.now = now; this.ttl = ttl;
    this.windows = new WeakSet(); this.completed = false;
  }
  capture(credentials) {
    this.clear();
    if (!validateCredentials(credentials)) throw new Error('Invalid CAS credential shape');
    this.user = Buffer.from(credentials.username, 'utf8');
    this.password = Buffer.from(credentials.password, 'utf8');
    this.deadline = this.now() + this.ttl;
    this.timer = setTimeout(() => { this.clear(); this.report('EXPIRED'); }, this.ttl);
    this.timer.unref?.();
  }
  clear() {
    clearTimeout(this.timer); this.timer = undefined;
    this.user?.fill(0); this.password?.fill(0);
    this.user = this.password = undefined; this.pending = undefined;
  }
  bind(contents) {
    this.windows.add(contents);
    contents.once('destroyed', () => { this.windows.delete(contents); this.clear(); });
  }
  trusted(event) {
    try {
      return this.ready() && this.windows.has(event.sender) && !event.sender.isDestroyed() &&
        event.senderFrame === event.sender.mainFrame && casDocument(event.senderFrame.url) &&
        event.sender.getURL() === event.senderFrame.url;
    } catch { return false; }
  }
  request(event, nonce) {
    if (!this.trusted(event) || typeof nonce !== 'string' || !/^[a-f0-9]{32}$/.test(nonce)) return null;
    if (!this.user || this.completed) return null;
    if (this.now() >= this.deadline) { this.clear(); return null; }
    const result = { username: this.user.toString('utf8'), password: this.password.toString('utf8'), nonce };
    this.clear(); // IPC copies strings; retain no reusable credential getter or second attempt.
    this.pending = { sender: event.sender, frame: event.senderFrame, nonce };
    return result;
  }
  outcome(event, message) {
    if (!this.trusted(event) || !message || !['PREFILLED', 'SKIPPED', 'UNSUPPORTED', 'UNAVAILABLE'].includes(message.status)) return;
    if (message.status === 'PREFILLED') {
      if (!this.pending || this.pending.sender !== event.sender || this.pending.frame !== event.senderFrame || this.pending.nonce !== message.nonce) return;
      this.completed = true;
    } else if (this.completed) { return; }
    this.clear();
    this.report(message.status);
  }
}
function registerCasIPC(ipcMain, owners) {
  ipcMain.handle('myneige:cas-prefill', (event, nonce) => owners.get(event.sender)?.request(event, nonce) ?? null);
  ipcMain.on('myneige:cas-result', (event, result) => owners.get(event.sender)?.outcome(event, result));
}
module.exports = { CasPrefill, casEndpoint, casDocument, registerCasIPC };
