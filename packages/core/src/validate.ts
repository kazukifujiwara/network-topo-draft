/**
 * Semantic validation (plan §4.6) — checks the JSON Schema cannot express.
 * Returns diagnostics as data; the VSCode wiring (Problems panel, JSON-path →
 * text-range resolution via jsonc-parser) arrives in Phase 3.
 *
 * Initial rule set:
 * - E duplicate-name       duplicate device / provider-network names
 * - E dangling-reference   link endpoint referencing a nonexistent
 *                          device / provider_network (or referencing nothing)
 * - W missing-lag-parent   `lag` names a parent interface that does not exist
 *                          on the same device
 * - W unknown-interface    an endpoint `interface` does not exist on that device
 * - W undeclared-vrf       a logical endpoint `vrf` appears neither in the
 *                          device's vrfs[] nor among interface-derived VRFs
 * - I missing-version      no `version` field (legacy file; saving adds it)
 */

import type { LogicalEndpoint, PhysicalEndpoint, Topology } from './model';
import { findDevice, findNetwork } from './model';
import { ipv4InCidr } from './cidr';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  | 'duplicate-name'
  | 'dangling-reference'
  | 'missing-lag-parent'
  | 'unknown-interface'
  | 'undeclared-vrf'
  | 'missing-version'
  | 'ip-outside-prefix';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  message: string;
  /** JSON path into the canonical document (e.g. ['cables', 0, 'a', 'device']). */
  path: (string | number)[];
}

export function validate(topology: Topology): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  /* --- I: missing version (legacy format) --- */
  if (topology.version === undefined) {
    diagnostics.push({
      severity: 'info',
      code: 'missing-version',
      message:
        'File has no "version" field (legacy TopoDraft export); saving will add "version": 1.',
      path: [],
    });
  }

  /* --- E: duplicate device / provider-network names --- */
  const seen = new Map<string, string>(); // name → where it was first seen
  topology.devices.forEach((d, i) => {
    if (seen.has(d.name)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate-name',
        message: `Duplicate name "${d.name}" (already used by a ${seen.get(d.name)}); link references resolve to the first occurrence.`,
        path: ['devices', i, 'name'],
      });
    } else {
      seen.set(d.name, 'device');
    }
  });
  (topology.provider_networks ?? []).forEach((p, i) => {
    if (seen.has(p.name)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate-name',
        message: `Duplicate name "${p.name}" (already used by a ${seen.get(p.name)}); link references resolve to the first occurrence.`,
        path: ['provider_networks', i, 'name'],
      });
    } else {
      seen.set(p.name, 'provider network');
    }
  });
  (topology.networks ?? []).forEach((n, i) => {
    if (seen.has(n.name)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate-name',
        message: `Duplicate name "${n.name}" (already used by a ${seen.get(n.name)}); link references resolve to the first occurrence.`,
        path: ['networks', i, 'name'],
      });
    } else {
      seen.set(n.name, 'network');
    }
  });

  const deviceNames = new Set(topology.devices.map((d) => d.name));
  const pnNames = new Set((topology.provider_networks ?? []).map((p) => p.name));
  const networkNames = new Set((topology.networks ?? []).map((n) => n.name));

  /* --- link endpoint checks --- */
  const checkEndpoint = (
    collection: 'cables' | 'circuits' | 'logical_links',
    index: number,
    side: 'a' | 'b',
    ep: PhysicalEndpoint | LogicalEndpoint,
  ): void => {
    const base = [collection, index, side];
    const netRef = (ep as LogicalEndpoint).network;
    if (netRef !== undefined) {
      if (!networkNames.has(netRef)) {
        diagnostics.push({
          severity: 'error',
          code: 'dangling-reference',
          message: `Endpoint references network "${netRef}", which does not exist in networks[].`,
          path: [...base, 'network'],
        });
      }
      return;
    }
    if (ep.provider_network !== undefined) {
      if (!pnNames.has(ep.provider_network)) {
        diagnostics.push({
          severity: 'error',
          code: 'dangling-reference',
          message: `Endpoint references provider network "${ep.provider_network}", which does not exist in provider_networks[].`,
          path: [...base, 'provider_network'],
        });
      }
      return;
    }
    if (ep.device === undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'dangling-reference',
        message: 'Endpoint references neither a "device", a "provider_network", nor a "network".',
        path: base,
      });
      return;
    }
    if (!deviceNames.has(ep.device)) {
      diagnostics.push({
        severity: 'error',
        code: 'dangling-reference',
        message: `Endpoint references device "${ep.device}", which does not exist in devices[].`,
        path: [...base, 'device'],
      });
      return;
    }
    const device = findDevice(topology, ep.device);
    if (!device) return;
    if (ep.interface !== undefined) {
      const exists = (device.interfaces ?? []).some((f) => f.name === ep.interface);
      if (!exists) {
        diagnostics.push({
          severity: 'warning',
          code: 'unknown-interface',
          message: `Interface "${ep.interface}" does not exist on device "${ep.device}".`,
          path: [...base, 'interface'],
        });
      }
    }
    if (collection === 'logical_links') {
      const vrf = ((ep as LogicalEndpoint).vrf ?? '').trim();
      if (vrf) {
        const declared = new Set((device.vrfs ?? []).map((v) => v.trim()).filter(Boolean));
        for (const f of device.interfaces ?? []) {
          const v = (f.vrf ?? '').trim();
          if (v) declared.add(v);
        }
        if (!declared.has(vrf)) {
          diagnostics.push({
            severity: 'warning',
            code: 'undeclared-vrf',
            message:
              `VRF "${vrf}" on device "${ep.device}" is neither declared in devices[].vrfs nor used by any interface. ` +
              `The editor derives a device's VRF compartments as vrfs[] ∪ interfaces[].vrf ∪ logical-endpoint VRFs, so it will still render — but declaring it explicitly is recommended.`,
            path: [...base, 'vrf'],
          });
        }
      }
    }
  };

  (topology.cables ?? []).forEach((c, i) => {
    checkEndpoint('cables', i, 'a', c.a ?? {});
    checkEndpoint('cables', i, 'b', c.b ?? {});
  });
  (topology.circuits ?? []).forEach((c, i) => {
    checkEndpoint('circuits', i, 'a', c.a ?? {});
    checkEndpoint('circuits', i, 'b', c.b ?? {});
  });
  (topology.logical_links ?? []).forEach((l, i) => {
    checkEndpoint('logical_links', i, 'a', l.a ?? {});
    checkEndpoint('logical_links', i, 'b', l.b ?? {});
  });

  /* --- W: lag refers to a missing parent interface on the same device --- */
  topology.devices.forEach((d, di) => {
    (d.interfaces ?? []).forEach((f, fi) => {
      if (f.lag === undefined) return;
      const parentExists = (d.interfaces ?? []).some((x) => x.name === f.lag);
      if (!parentExists) {
        diagnostics.push({
          severity: 'warning',
          code: 'missing-lag-parent',
          message: `Interface "${f.name ?? ''}" on device "${d.name}" names LAG parent "${f.lag}", but no such interface exists on the same device.`,
          path: ['devices', di, 'interfaces', fi, 'lag'],
        });
      }
    });
  });

  /* --- W: IPs outside a segment's prefix (spec §3.10) --- */
  (topology.networks ?? []).forEach((n, ni) => {
    const prefix = (n.prefix ?? '').trim();
    if (!prefix) return;
    const vip = (n.fhrp?.virtual_ip ?? '').trim();
    if (vip && ipv4InCidr(vip, prefix) === false) {
      diagnostics.push({
        severity: 'warning',
        code: 'ip-outside-prefix',
        message: `FHRP virtual IP "${vip}" is outside this network's prefix ${prefix}.`,
        path: ['networks', ni, 'fhrp', 'virtual_ip'],
      });
    }
  });
  (topology.logical_links ?? []).forEach((l, li) => {
    const sides: ['a' | 'b', 'a' | 'b'] = ['a', 'b'];
    for (const side of sides) {
      const other: 'a' | 'b' = side === 'a' ? 'b' : 'a';
      const netName = l[other].network;
      if (netName === undefined) continue;
      const prefix = (findNetwork(topology, netName)?.prefix ?? '').trim();
      if (!prefix) continue;
      const ep = l[side];
      if (ep.device === undefined) continue;
      // effective IP: the endpoint's own, or its named interface's on the device
      let ip = (ep.ip_address ?? '').trim();
      let path: (string | number)[] = ['logical_links', li, side, 'ip_address'];
      if (!ip && ep.interface !== undefined) {
        const device = findDevice(topology, ep.device);
        const ifIdx = (device?.interfaces ?? []).findIndex((f) => f.name === ep.interface);
        const iface = ifIdx >= 0 ? device?.interfaces?.[ifIdx] : undefined;
        if (iface?.ip_address) {
          ip = iface.ip_address.trim();
          const di = topology.devices.findIndex((d) => d.name === ep.device);
          path = ['devices', di, 'interfaces', ifIdx, 'ip_address'];
        }
      }
      if (ip && ipv4InCidr(ip, prefix) === false) {
        diagnostics.push({
          severity: 'warning',
          code: 'ip-outside-prefix',
          message: `IP "${ip}" on "${ep.device}" is outside the prefix ${prefix} of network "${netName}".`,
          path,
        });
      }
    }
  });

  return diagnostics;
}
