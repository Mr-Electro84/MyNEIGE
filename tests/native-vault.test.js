'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { NativeVault } = require('../src/main/native-vault');
function transport(replies) {
  const frames = []; let active = 0, peak = 0;
  const launch = (_executable, args, options) => {
    assert.deepEqual(args, ['vault-worker']); assert.equal(options.windowsHide, true);
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = new EventEmitter(); child.kill = () => child.emit('close', null);
    child.stdin.end = frame => {
      frames.push(frame); ++active; peak = Math.max(peak, active);
      setImmediate(() => { const reply = replies.shift(); --active; child.stdout.emit('data', Buffer.from(reply)); child.emit('close', 0); });
    };
    return child;
  };
  return { vault: new NativeVault('protected-helper.exe', launch), frames, peak: () => peak };
}
test('vault status exposes only existence and Hello availability, operations serialize', async () => {
  const f = transport(['STATUS PRESENT AVAILABLE\n', 'OK\n']);
  const [status] = await Promise.all([f.vault.status(), f.vault.forget()]);
  assert.deepEqual(status, { saved: true, hello: true }); assert.equal(f.peak(), 1);
  assert.deepEqual(f.frames, ['STATUS\n', 'DELETE\n']);
  assert.equal(await f.vault.queue, undefined);
});
test('Hello refusal returns no credentials and no implicit read follows', async () => {
  const f = transport(['DENIED\n']); assert.equal(await f.vault.unlock(123n), null);
  assert.deepEqual(f.frames, ['UNLOCK 123\n']);
});
test('only a valid native credential frame may unlock; queue retains no password', async () => {
  const f = transport(['CREDENTIALS 666963746966 736563726574\n']);
  assert.deepEqual(await f.vault.unlock(123n), { username: 'fictif', password: 'secret' });
  assert.equal(await f.vault.queue, undefined);
  for (const response of ['OK\n', 'CREDENTIALS 61 0a\n', 'CREDENTIALS 61 ff\n', 'CREDENTIALS 6 62\n', 'CREDENTIALS 61 62\nOK\n']) {
    await assert.rejects(transport([response]).vault.unlock(123n), /VAULT_UNAVAILABLE/);
  }
});
test('saving validates credentials and sends secrets only through stdin, not arguments', async () => {
  const f = transport(['OK\n']); await f.vault.save({ username: 'fictif', password: 'secret' });
  assert.equal(f.frames[0], 'WRITE 666963746966 736563726574\n');
  await assert.rejects(f.vault.save({ username: 'fictif', password: 'x\nDELETE' }));
  assert.equal(f.frames.length, 1);
});
test('a stopped vault cannot start another operation', async () => {
  const f = transport([]); f.vault.stop(); await assert.rejects(f.vault.status()); assert.equal(f.frames.length, 0);
});
