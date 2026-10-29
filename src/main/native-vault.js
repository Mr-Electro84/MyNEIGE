'use strict';
const { spawn } = require('node:child_process');
const { validateCredentials } = require('./policy');

class NativeVault {
  constructor(executable, launch = spawn) {
    this.executable = executable; this.launch = launch; this.queue = Promise.resolve(); this.stopped = false;
  }
  request(command) {
    const operation = this.queue.then(() => new Promise((resolve, reject) => {
      if (this.stopped) { reject(new Error('VAULT_UNAVAILABLE')); return; }
      const child = this.launch(this.executable, ['vault-worker'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.active = child;
      const chunks = []; let size = 0, settled = false;
      const finish = (error, value) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (this.active === child) this.active = undefined;
        for (const chunk of chunks) chunk.fill(0);
        error ? reject(new Error('VAULT_UNAVAILABLE')) : resolve(value);
      };
      const timer = setTimeout(() => { child.kill(); finish(true); }, 120000);
      child.stdout.on('data', chunk => {
        size += chunk.length;
        if (size > (command === 'PROFILE_READ' ? 131100 : 17050)) { chunk.fill(0); child.kill(); finish(true); } else chunks.push(chunk);
      });
      // Never forward native stderr, command frames or credential responses to logs.
      child.stderr.on('data', chunk => chunk.fill(0));
      child.once('error', () => finish(true));
      child.stdin.on('error', () => { child.kill(); finish(true); });
      child.once('close', code => {
        const bytes = Buffer.concat(chunks);
        const response = bytes.toString('utf8').trim(); bytes.fill(0);
        finish(code !== 0 || response.includes('\n') || response.includes('\r'), response);
      });
      child.stdin.end(command + '\n');
    }));
    // The queue must never retain a fulfilled credential response.
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
  async status() {
    const response = await this.request('STATUS');
    const match = /^STATUS (PRESENT|EMPTY) (AVAILABLE|UNAVAILABLE)$/.exec(response);
    if (!match) throw new Error('VAULT_UNAVAILABLE');
    return { saved: match[1] === 'PRESENT', hello: match[2] === 'AVAILABLE' };
  }
  async save(credentials, fingerprint) {
    if (!validateCredentials(credentials) || !/^[A-F0-9]{64}$/.test(fingerprint || '')) throw new Error('VAULT_UNAVAILABLE');
    const user = Buffer.from(credentials.username), password = Buffer.from(credentials.password);
    try {
      if (await this.request(`WRITE ${user.toString('hex')} ${password.toString('hex')} ${fingerprint}`) !== 'OK') throw new Error('VAULT_UNAVAILABLE');
    } finally { user.fill(0); password.fill(0); }
  }
  async unlock(handle, fingerprint) {
    if (typeof handle !== 'bigint' || handle <= 0n || !/^[A-F0-9]{64}$/.test(fingerprint || '')) throw new Error('VAULT_UNAVAILABLE');
    const response = await this.request(`UNLOCK ${handle} ${fingerprint}`);
    if (response === 'DENIED') return null;
    const match = /^CREDENTIALS ([a-f0-9]{2,8192}) ([a-f0-9]{2,8192})$/.exec(response);
    if (!match || match[1].length % 2 || match[2].length % 2) throw new Error('VAULT_UNAVAILABLE');
    const user = Buffer.from(match[1], 'hex'), password = Buffer.from(match[2], 'hex');
    try {
      const credentials = { username: user.toString('utf8'), password: password.toString('utf8') };
      if (!validateCredentials(credentials) || !Buffer.from(credentials.username).equals(user) || !Buffer.from(credentials.password).equals(password)) throw new Error('VAULT_UNAVAILABLE');
      return credentials;
    } finally { user.fill(0); password.fill(0); }
  }
  async forget() { if (await this.request('DELETE') !== 'OK') throw new Error('VAULT_UNAVAILABLE'); }
  async readProfile() {
    const response = await this.request('PROFILE_READ');
    if (response === 'PROFILE_EMPTY') return null;
    const match = /^PROFILE ([a-f0-9]{2,131070})$/.exec(response);
    if (!match || match[1].length % 2) throw new Error('PROFILE_UNAVAILABLE');
    return Buffer.from(match[1], 'hex');
  }
  async saveProfile(source) {
    if (!Buffer.isBuffer(source) || !source.length || source.length >= 65536) throw new Error('PROFILE_UNAVAILABLE');
    if (await this.request(`PROFILE_WRITE ${source.toString('hex')}`) !== 'OK') throw new Error('PROFILE_UNAVAILABLE');
  }
  async forgetProfile() { if (await this.request('PROFILE_DELETE') !== 'OK') throw new Error('PROFILE_UNAVAILABLE'); }
  cancelActive() { this.active?.kill(); }
  stop() { this.stopped = true; this.cancelActive(); }
}
module.exports = { NativeVault };
