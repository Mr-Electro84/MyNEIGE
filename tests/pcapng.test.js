'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readPcapng, decodePacket } = require('../scripts/pcapng');
function ipPacket() {
  const packet = Buffer.alloc(28);
  packet[0] = 0x45; packet[9] = 17;
  Buffer.from([10, 40, 0, 16, 195, 83, 163, 60]).copy(packet, 12);
  packet.writeUInt16BE(53000, 20); packet.writeUInt16BE(53, 22);
  return packet;
}
function block(type, data) {
  const size = 12 + Math.ceil(data.length / 4) * 4, result = Buffer.alloc(size);
  result.writeUInt32LE(type, 0); result.writeUInt32LE(size, 4); data.copy(result, 8); result.writeUInt32LE(size, size - 4);
  return result;
}
function fixture(packet) {
  const section = Buffer.alloc(16); section.writeUInt32LE(0x1a2b3c4d); section.writeUInt16LE(1, 4); section.fill(0xff, 8);
  const nic = Buffer.alloc(8); nic.writeUInt16LE(1); nic.writeUInt32LE(96, 4);
  const info = Buffer.alloc(20); info.writeUInt32LE(packet.length, 12); info.writeUInt32LE(packet.length, 16);
  return Buffer.concat([block(0x0a0d0d0a, section), block(1, nic), block(6, Buffer.concat([info, packet]))]);
}
function ethernet() { const result = Buffer.alloc(14 + 28); result.writeUInt16BE(0x0800, 12); ipPacket().copy(result, 14); return result; }
test('Ethernet IPv4 UDP headers identify a VPN DNS flow', () => {
  const packet = decodePacket(ethernet(), 1);
  assert.deepEqual(packet, { version: 4, source: '10.40.0.16', destination: '195.83.163.60', protocol: 17, sourcePort: 53000, destinationPort: 53 });
});
test('Pktmon native Wi-Fi mislabeled Ethernet is decoded using the full LLC header', () => {
  const wifi = Buffer.alloc(32 + 28); wifi.writeUInt16LE(0x0108); Buffer.from([0xaa, 0xaa, 3, 0, 0, 0, 8, 0]).copy(wifi, 24); ipPacket().copy(wifi, 32);
  assert.equal(decodePacket(wifi, 1).destinationPort, 53);
});
test('pcapng block parser extracts headers and rejects corrupted lengths', () => {
  const capture = fixture(ethernet());
  assert.equal(readPcapng(capture).packets.length, 1);
  assert.throws(() => readPcapng(capture.subarray(0, capture.length - 1)));
  const invalid = Buffer.from(capture); invalid.writeUInt32LE(0x7ffffffc, 4); assert.throws(() => readPcapng(invalid));
});
test('pcapng cannot refer to an unknown interface or read beyond a packet block', () => {
  const badInterface = fixture(ethernet()); badInterface.writeUInt32LE(9, 28 + 20 + 8); assert.throws(() => readPcapng(badInterface));
  const badLength = fixture(ethernet()); badLength.writeUInt32LE(65535, 28 + 20 + 20); assert.throws(() => readPcapng(badLength));
});
test('short IP headers, IP fragments and non-IP frames are excluded', () => {
  assert.equal(decodePacket(Buffer.alloc(4), 1), null);
  const fragment = ethernet(); fragment.writeUInt16BE(1, 14 + 6); assert.equal(decodePacket(fragment, 1), null);
  const arp = Buffer.alloc(42); arp.writeUInt16BE(0x0806, 12); assert.equal(decodePacket(arp, 1), null);
});
