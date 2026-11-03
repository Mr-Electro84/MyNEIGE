'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { readPcapng } = require('./pcapng');
const { readText } = require('./read-text');
const root = path.resolve(process.argv[2] || fs.readFileSync(path.join(__dirname, '../.local/j1-latest.txt'), 'utf8').trim());
const json = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, ''));
const names = fs.readdirSync(root);
const logs = ['qualify.txt', 'qualify-crash.txt', 'control-flows.txt'].filter(name => names.includes(name)).map(name => readText(path.join(root, name))).join('\n');
const wireNics = new Map();
for (const name of names.filter(name => /components.*\.json$/.test(name))) {
  for (const group of json(name)) {
    for (const component of group.Components) {
      const index = component.Properties?.find(prop => prop.Name === 'ifIndex')?.Value;
      const guid = component.Properties?.find(prop => prop.Name === 'ifGuid')?.Value;
      if (component.Type === 'Miniport' && index !== undefined && guid) wireNics.set(component.Id,
        { id: component.Id, ifIndex: index, guid, name: component.Name, driver: component.DriverName });
    }
  }
}
const nics = [...wireNics.values()];
const vpnIndices = new Set([...logs.matchAll(/^VPN_INTERFACE index=(\d+)/gm)].map(match => Number(match[1])));
const vpnLuids = new Set([...logs.matchAll(/^VPN_INTERFACE index=\d+ luid=(\d+)/gm)].map(match => match[1]));
const vpnGuids = new Set();
for (const scenario of ['qualify', 'qualify-crash']) {
  if (!names.includes(scenario + '.txt')) continue;
  const index = Number(readText(path.join(root, scenario + '.txt')).match(/^VPN_INTERFACE index=(\d+)/m)?.[1]);
  const snapshot = json(scenario + '-components.json');
  for (const nic of snapshot.flatMap(group => group.Components)) {
    if (nic.Properties?.some(prop => prop.Name === 'ifIndex' && prop.Value === index)) {
      const guid = nic.Properties.find(prop => prop.Name === 'ifGuid')?.Value;
      if (guid) vpnGuids.add(guid);
    }
  }
}
const packets = nics.flatMap(nic => {
  const file = path.join(root, `component-${nic.id}.pcapng`);
  if (!fs.existsSync(file)) throw new Error(`Missing component capture ${nic.id}`);
  const decoded = readPcapng(fs.readFileSync(file));
  return decoded.packets.map(packet => ({ ...packet, ifIndex: nic.ifIndex, component: nic.id, vpn: vpnGuids.has(nic.guid) }));
});
const flows = [...logs.matchAll(/^VPN_FLOW role=(DNS|WEB|SSH) protocol=(UDP|TCP) source=([\d.]+):(\d+) destination=([\d.]+):(\d+)/gm)]
  .map(m => ({ role: m[1], protocol: m[2] === 'TCP' ? 6 : 17, source: m[3], sourcePort: Number(m[4]), destination: m[5], destinationPort: Number(m[6]) }));
const controls = [...logs.matchAll(/^HOST_CONTROL_FLOW source=([\d.]+):(\d+) destination=([\d.]+):(\d+)([^\r\n]*)/gm)]
  .map(m => ({ source: m[1], sourcePort: Number(m[2]), destination: m[3], destinationPort: Number(m[4]), phase: m[5].match(/phase=(active|after)/)?.[1] || 'unspecified' }));
const transports = [...logs.matchAll(/^OPENVPN_TRANSPORT source=([\d.]+):(\d+) destination=([\d.]+):(\d+)/gm)]
  .map(m => ({ source: m[1], sourcePort: Number(m[2]), destination: m[3], destinationPort: Number(m[4]) }));
for (const flow of controls) {
  if (flow.source !== '0.0.0.0') continue;
  // A failed nonblocking connect can reset getsockname's source address. Recover
  // it only from a unique observed physical flow with this exact port/destination.
  const sources = new Set(packets.filter(p => !p.vpn && p.sourcePort === flow.sourcePort && p.destination === flow.destination && p.destinationPort === flow.destinationPort).map(p => p.source));
  if (sources.size === 1) flow.source = [...sources][0];
}
const flowMatch = (packet, flow) => packet.source === flow.source && packet.sourcePort === flow.sourcePort &&
  packet.destination === flow.destination && packet.destinationPort === flow.destinationPort && (flow.protocol === undefined || packet.protocol === flow.protocol);
const targetIPs = new Set([...logs.matchAll(/^TARGET_IPV4 ([\d.]+)/gm)].map(m => m[1]));
const dnsIPs = new Set([...logs.matchAll(/pushed_dns=([\d.,]+)/g)].flatMap(m => m[1].split(',')));
const physical = packets.filter(packet => !packet.vpn);
const forbidden = physical.filter(packet => packet.version === 4 && (
  targetIPs.has(packet.destination) && packet.destinationPort === 443 && !controls.concat(transports).some(flow => flowMatch(packet, flow)) ||
  dnsIPs.has(packet.destination) && packet.destinationPort === 53 ||
  flows.some(flow => flowMatch(packet, flow))));
const report = {
  schema: 1, root, capturedHeaderPackets: packets.length, tunnelInterfaces: [...vpnIndices],
  tunnelGenerations: vpnGuids.size, distinctLuids: vpnLuids.size,
  observedTunnelWeb: packets.filter(p => p.vpn && targetIPs.has(p.destination) && p.destinationPort === 443).length,
  observedTunnelSsh: packets.filter(p => p.vpn && flows.some(flow => flow.role === 'SSH' && flowMatch(p, flow))).length,
  observedTunnelDnsUdp: packets.filter(p => p.vpn && dnsIPs.has(p.destination) && p.destinationPort === 53 && p.protocol === 17).length,
  observedTunnelDnsTcp: packets.filter(p => p.vpn && dnsIPs.has(p.destination) && p.destinationPort === 53 && p.protocol === 6).length,
  ordinaryApplicationPhysicalPackets: physical.filter(p => controls.some(flow => flowMatch(p, flow))).length,
  ordinaryApplicationTunnelPackets: packets.filter(p => p.vpn && controls.some(flow => flowMatch(p, flow))).length,
  ordinaryApplicationActivePhysicalPackets: physical.filter(p => controls.some(flow => flow.phase === 'active' && flowMatch(p, flow))).length,
  vpnTransportPhysicalPackets: physical.filter(p => transports.some(flow => flowMatch(p, flow))).length,
  forbiddenPhysicalPackets: forbidden.length,
  flaggedComponents: [...new Set(forbidden.map(p => p.component))].map(id => ({ ...nics.find(n => n.id === id), count: forbidden.filter(p => p.component === id).length })),
  controllerCrashChildrenStopped: fs.existsSync(path.join(root, 'recovery.txt')) && readText(path.join(root, 'recovery.txt')).includes('JOB_CHILDREN_STOPPED_AFTER_CRASH'),
  nativeCodes: names.includes('native-exit-codes.json') && fs.statSync(path.join(root, 'native-exit-codes.json')).size ? json('native-exit-codes.json') : [],
  proofScope: 'Observed controlled sessions only; no claim about unexecuted sleep/third-party-VPN scenarios'
};
const failures = [];
const check = action => { try { action(); } catch (error) { failures.push(error.message); } };
if (logs) {
  check(() => {
  assert(report.observedTunnelWeb > 0, 'No positive tunnel WEB capture');
  assert(report.vpnTransportPhysicalPackets > 0, 'VPN transport missing from physical capture');
  assert(report.observedTunnelDnsUdp > 0 && report.observedTunnelDnsTcp > 0, 'Missing UDP/TCP tunnel DNS proof');
  });
  check(() => {
  assert(report.ordinaryApplicationActivePhysicalPackets > 0 && report.ordinaryApplicationTunnelPackets === 0, 'Ordinary application route proof during active VPN failed or missing');
  });
  check(() => {
  assert.equal(report.forbiddenPhysicalPackets, 0, 'Forbidden physical traffic observed');
  });
  check(() => {
  if (names.includes('qualify-crash.txt')) {
    assert.equal(vpnGuids.size, 2, 'Two distinct VPN interface GUIDs required; Windows may reuse LUID/index');
    assert(report.controllerCrashChildrenStopped, 'Missing actual controller-crash proof');
    assert.deepEqual(report.nativeCodes, [0, 86], 'Both qualification scenarios must finish as expected');
  } else { assert.deepEqual([].concat(report.nativeCodes), [0], 'Normal qualification must finish successfully'); }
  });
  check(() => {
  const canonical = values => values.map(value => JSON.stringify(value)).sort();
  assert.deepEqual(canonical(json('routes-after.json')), canonical(json('routes-before.json')), 'Host route baseline not restored');
  assert.deepEqual(canonical(json('dns-after.json')), canonical(json('dns-before.json')), 'Host DNS baseline not restored');
  });
  check(() => {
  const text = readText(path.join(root, 'capture.txt'));
  assert(/EventsLost: 0/.test(text) && /BuffersLost: 0/.test(text), 'Capture event loss is unknown or nonzero');
  });
}
report.validation = !logs ? 'probe_only' : failures.length ? 'incomplete_or_failed' : 'passed_for_observed_scope';
report.failures = failures;
fs.writeFileSync(path.join(root, 'analysis.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
