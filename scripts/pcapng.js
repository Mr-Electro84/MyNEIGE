'use strict';
// Read only link/IP/transport headers. Never expose or decode packet payloads.
function readPcapng(buffer) {
  let offset = 0, little = true, interfaces = [], packets = [], skipped = 0;
  const u32 = at => little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at);
  const u16 = at => little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at);
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error('Truncated pcapng block');
    const section = buffer.readUInt32LE(offset) === 0x0a0d0d0a;
    if (section) {
      if (offset + 28 > buffer.length) throw new Error('Truncated section header');
      const magic = buffer.readUInt32LE(offset + 8);
      if (![0x1a2b3c4d, 0x4d3c2b1a].includes(magic)) throw new Error('Invalid pcapng byte order');
      little = magic === 0x1a2b3c4d; interfaces = [];
    }
    const type = u32(offset), size = u32(offset + 4);
    if (size < 12 || size % 4 || offset + size > buffer.length || u32(offset + size - 4) !== size) throw new Error('Invalid pcapng block size');
    if (type === 1) {
      if (size < 20) throw new Error('Short interface block');
      interfaces.push({ link: u16(offset + 8) });
    } else if (type === 6) {
      if (size < 32) throw new Error('Short packet block');
      const index = u32(offset + 8), length = u32(offset + 20);
      if (!interfaces[index] || length > size - 32) throw new Error('Invalid packet interface/length');
      const packet = decodePacket(buffer.subarray(offset + 28, offset + 28 + length), interfaces[index].link);
      if (packet) packets.push(packet); else skipped++;
    }
    offset += size;
  }
  return { packets, skipped };
}
function decodePacket(bytes, link) {
  let offset = 0, kind;
  if (link === 1) {
    if (bytes.length < 14) return null;
    kind = bytes.readUInt16BE(12); offset = 14;
    // Pktmon's converter labels native Wi-Fi frames as Ethernet. Recognize the
    // complete 802.11 + LLC/SNAP structure rather than interpreting MAC bytes as IP.
    if (![0x0800, 0x86dd, 0x8100, 0x88a8].includes(kind) && bytes.length >= 32 &&
        (bytes.readUInt16LE(0) & 0x000f) === 8 && bytes.indexOf(Buffer.from([0xaa, 0xaa, 3]), 24) >= 24) {
      return decodePacket(bytes, 105);
    }
    while ([0x8100, 0x88a8].includes(kind)) { if (offset + 4 > bytes.length) return null; kind = bytes.readUInt16BE(offset + 2); offset += 4; }
  } else if ([105, 127].includes(link)) {
    if (link === 127) { if (bytes.length < 8) return null; offset = bytes.readUInt16LE(2); }
    if (offset + 24 > bytes.length) return null;
    const flags = bytes.readUInt16LE(offset);
    if ((flags & 0x0c) !== 8) return null; // Data frames only.
    offset += 24 + ((flags & 0x0300) === 0x0300 ? 6 : 0);
    if (flags & 0x0080) { offset += 2; if (flags & 0x8000) offset += 4; }
    if (offset + 8 > bytes.length || bytes[offset] !== 0xaa || bytes[offset + 1] !== 0xaa || bytes[offset + 2] !== 3) return null;
    kind = bytes.readUInt16BE(offset + 6); offset += 8;
  } else if ([101, 228, 229].includes(link)) {
    if (!bytes.length) return null;
    kind = bytes[0] >> 4 === 4 ? 0x0800 : 0x86dd;
  } else if (link === 0) {
    offset = 4;
    if (bytes.length <= offset) return null;
    kind = bytes[offset] >> 4 === 4 ? 0x0800 : 0x86dd;
  } else { throw new Error(`Unsupported link type ${link}`); }
  let source, destination, protocol, version;
  if (kind === 0x0800) {
    if (offset + 20 > bytes.length || bytes[offset] >> 4 !== 4) return null;
    const header = (bytes[offset] & 15) * 4;
    if (header < 20 || offset + header > bytes.length) return null;
    if (bytes.readUInt16BE(offset + 6) & 0x1fff) return null;
    source = [...bytes.subarray(offset + 12, offset + 16)].join('.');
    destination = [...bytes.subarray(offset + 16, offset + 20)].join('.');
    protocol = bytes[offset + 9]; offset += header; version = 4;
  } else if (kind === 0x86dd) {
    if (offset + 40 > bytes.length || bytes[offset] >> 4 !== 6) return null;
    const ipv6 = at => Array.from({ length: 8 }, (_, n) => bytes.readUInt16BE(at + n * 2).toString(16)).join(':');
    source = ipv6(offset + 8); destination = ipv6(offset + 24);
    protocol = bytes[offset + 6]; offset += 40; version = 6;
    for (let n = 0; [0, 43, 60, 44, 51].includes(protocol); n++) {
      if (n > 8 || offset + 8 > bytes.length) return null;
      const next = bytes[offset];
      const length = protocol === 44 ? 8 : protocol === 51 ? (bytes[offset + 1] + 2) * 4 : (bytes[offset + 1] + 1) * 8;
      if (protocol === 44 && bytes.readUInt16BE(offset + 2) & 0xfff8) return null;
      offset += length; protocol = next;
    }
  } else return null;
  const result = { version, source, destination, protocol };
  if ([6, 17].includes(protocol)) {
    if (offset + 4 > bytes.length) return null;
    result.sourcePort = bytes.readUInt16BE(offset); result.destinationPort = bytes.readUInt16BE(offset + 2);
    if (protocol === 6 && offset + 14 <= bytes.length) result.flags = bytes[offset + 13];
  }
  return result;
}
module.exports = { readPcapng, decodePacket };
