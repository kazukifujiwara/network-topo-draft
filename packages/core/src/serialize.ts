/**
 * Canonical serializer (format spec §4, ADR D12).
 *
 * 1. 2-space indentation, LF, exactly one trailing newline
 * 2. Top-level key order: $schema → version → devices → provider_networks →
 *    networks → cables → circuits → logical_links
 * 3. Keys inside each object follow the §3 tables; `position` always last
 * 4. Array order is preserved — never re-sorted
 * 5. Empty fields (empty string / array / object) are not emitted
 *    (except inside config_context, which is preserved verbatim)
 * 6. Deterministic: identical model → byte-identical output;
 *    serialize(parse(text)) is idempotent
 *
 * `$schema` is passed through verbatim when present and never injected (O3).
 * `version: 1` is always written, normalizing legacy files on save (ADR D9).
 */

import type {
  Cable,
  Circuit,
  Device,
  DeviceInterface,
  FhrpConfig,
  LogicalEndpoint,
  LogicalLink,
  Network,
  PhysicalEndpoint,
  Position,
  ProviderNetwork,
  Topology,
} from './model';
import { findDevice, siteOf } from './model';

/** Model → canonical JSON text. */
export function serialize(topology: Topology): string {
  return JSON.stringify(toCanonical(topology), null, 2) + '\n';
}

/**
 * Model → canonical model: keys ordered, empties dropped, `version: 1`
 * forced, positions rounded, circuit endpoint sites re-derived from the
 * device. `serialize()` is exactly `JSON.stringify(toCanonical(t), null, 2)`
 * plus a trailing newline; generators reuse this to embed canonical data.
 */
export function toCanonical(topology: Topology): Topology {
  const out = {} as Topology;
  if (typeof topology.$schema === 'string' && topology.$schema !== '') {
    out.$schema = topology.$schema;
  }
  out.version = 1;
  out.devices = topology.devices.map((d) => canonicalDevice(d));
  const pns = (topology.provider_networks ?? []).map((p) => canonicalProviderNetwork(p));
  if (pns.length) out.provider_networks = pns;
  const networks = (topology.networks ?? []).map((n) => canonicalNetwork(n));
  if (networks.length) out.networks = networks;
  const cables = (topology.cables ?? []).map((c) => canonicalCable(c));
  if (cables.length) out.cables = cables;
  const circuits = (topology.circuits ?? []).map((c) => canonicalCircuit(c, topology));
  if (circuits.length) out.circuits = circuits;
  const logical = (topology.logical_links ?? []).map((l) => canonicalLogicalLink(l));
  if (logical.length) out.logical_links = logical;
  return out;
}

/* ---------- helpers ---------- */

function put<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value === undefined || value === '') return;
  target[key] = value as T[K];
}

function roundPosition(p: Position | undefined): Position | undefined {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return undefined;
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

function canonicalInterface(f: DeviceInterface): DeviceInterface | undefined {
  const out: DeviceInterface = {};
  put(out, 'name', f.name);
  put(out, 'ip_address', f.ip_address);
  put(out, 'type', f.type);
  put(out, 'description', f.description);
  put(out, 'lag', f.lag);
  put(out, 'vrf', f.vrf);
  return Object.keys(out).length ? out : undefined;
}

function canonicalDevice(d: Device): Device {
  const out = { name: d.name ?? '' } as Device;
  put(out, 'device_type', d.device_type);
  put(out, 'role', d.role);
  put(out, 'site', d.site);
  put(out, 'tenant', d.tenant);
  put(out, 'platform', d.platform);
  const vrfs = (d.vrfs ?? []).map((v) => v.trim()).filter(Boolean);
  if (vrfs.length) out.vrfs = vrfs;
  const interfaces = (d.interfaces ?? [])
    .map(canonicalInterface)
    .filter((f): f is DeviceInterface => f !== undefined);
  if (interfaces.length) out.interfaces = interfaces;
  // config_context is preserved verbatim (spec §3.3); empty object omitted.
  if (d.config_context && Object.keys(d.config_context).length) {
    out.config_context = d.config_context;
  }
  const position = roundPosition(d.position);
  if (position) out.position = position;
  return out;
}

function canonicalProviderNetwork(p: ProviderNetwork): ProviderNetwork {
  const out = { name: p.name ?? '' } as ProviderNetwork;
  put(out, 'provider', p.provider);
  put(out, 'description', p.description);
  const position = roundPosition(p.position);
  if (position) out.position = position;
  return out;
}

function canonicalNetwork(n: Network): Network {
  const out = { name: n.name ?? '' } as Network;
  put(out, 'prefix', n.prefix);
  put(out, 'vlan', n.vlan);
  if (n.fhrp) {
    const fhrp = {} as FhrpConfig;
    put(fhrp, 'protocol', n.fhrp.protocol);
    put(fhrp, 'group_id', n.fhrp.group_id);
    put(fhrp, 'virtual_ip', n.fhrp.virtual_ip);
    if (Object.keys(fhrp).length) out.fhrp = fhrp;
  }
  put(out, 'description', n.description);
  const position = roundPosition(n.position);
  if (position) out.position = position;
  return out;
}

function canonicalCableEndpoint(ep: PhysicalEndpoint): PhysicalEndpoint {
  if (ep.provider_network) return { provider_network: ep.provider_network };
  const out: PhysicalEndpoint = {};
  put(out, 'device', ep.device);
  put(out, 'interface', ep.interface);
  return out;
}

function canonicalCircuitEndpoint(ep: PhysicalEndpoint, topology: Topology): PhysicalEndpoint {
  if (ep.provider_network) return { provider_network: ep.provider_network };
  const out: PhysicalEndpoint = {};
  // The endpoint site is informational and derived from the device (v7 epOut);
  // the stored value is only kept when the reference does not resolve.
  const device = ep.device ? findDevice(topology, ep.device) : undefined;
  put(out, 'site', device ? siteOf(device) : ep.site);
  put(out, 'device', ep.device);
  put(out, 'interface', ep.interface);
  return out;
}

function canonicalLogicalEndpoint(ep: LogicalEndpoint): LogicalEndpoint {
  if (ep.provider_network) {
    const out: LogicalEndpoint = { provider_network: ep.provider_network };
    put(out, 'id', ep.id?.trim());
    return out;
  }
  if (ep.network) return { network: ep.network };
  const out: LogicalEndpoint = {};
  put(out, 'device', ep.device);
  put(out, 'vrf', ep.vrf?.trim());
  put(out, 'id', ep.id?.trim());
  put(out, 'interface', ep.interface);
  // parse()/operations keep ip_address on an endpoint only where the format
  // allows it (no interface) or where dropping it would destroy data
  // (dangling device reference) — emit it whenever present.
  put(out, 'ip_address', ep.ip_address);
  return out;
}

function canonicalCable(c: Cable): Cable {
  const out = {
    a: canonicalCableEndpoint(c.a ?? {}),
    b: canonicalCableEndpoint(c.b ?? {}),
  } as Cable;
  put(out, 'type', c.type);
  put(out, 'bandwidth', c.bandwidth);
  put(out, 'status', c.status);
  put(out, 'label', c.label);
  return out;
}

function canonicalCircuit(c: Circuit, topology: Topology): Circuit {
  const out = {
    a: canonicalCircuitEndpoint(c.a ?? {}, topology),
    b: canonicalCircuitEndpoint(c.b ?? {}, topology),
  } as Circuit;
  put(out, 'cid', c.cid);
  put(out, 'provider', c.provider);
  put(out, 'type', c.type);
  put(out, 'commit_rate', c.commit_rate);
  put(out, 'status', c.status);
  return out;
}

function canonicalLogicalLink(l: LogicalLink): LogicalLink {
  const out = {
    a: canonicalLogicalEndpoint(l.a ?? {}),
    b: canonicalLogicalEndpoint(l.b ?? {}),
  } as LogicalLink;
  put(out, 'link_id', l.link_id);
  put(out, 'vlan', l.vlan);
  put(out, 'label', l.label);
  put(out, 'description', l.description);
  return out;
}
