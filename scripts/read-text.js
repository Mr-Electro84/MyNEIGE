'use strict';
const fs = require('node:fs');
function decodeText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    if (bytes.length % 2) throw new Error('Truncated UTF-16 text');
    return bytes.subarray(2).toString('utf16le');
  }
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}
module.exports = { decodeText, readText: filename => decodeText(fs.readFileSync(filename)) };
