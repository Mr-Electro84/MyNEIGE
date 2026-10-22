'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodeText } = require('../scripts/read-text');

test('capture logs from PowerShell UTF-16 and UTF-8 preserve flow evidence', () => {
  const line = 'VPN_FLOW role=DNS protocol=TCP source=10.40.0.3:1234 destination=195.83.163.60:53\r\n';
  assert.equal(decodeText(Buffer.concat([Buffer.from([255, 254]), Buffer.from(line, 'utf16le')])), line);
  assert.equal(decodeText(Buffer.from('\uFEFF' + line)), line);
  assert.equal(decodeText(Buffer.from(line)), line);
  assert.throws(() => decodeText(Buffer.from([255, 254, 65])), /Truncated/);
});
