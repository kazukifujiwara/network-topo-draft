/**
 * JSON text → canonical Topology model, absorbing every legacy input listed
 * in format spec §7 (ported from v7 `importData`):
 *
 * - missing `version`            → read as v1; the absence is preserved on the
 *                                  model so validate() can report it (Info) and
 *                                  serialize() adds `version: 1` on save
 * - v3 top-level `vrf` on a logical link → expanded onto both endpoints
 * - logical endpoint with both `interface` and `ip_address` → the IP (and, if
 *   the interface has none, the VRF) is written onto the device-side
 *   interfaces[] entry (created if missing), and dropped from the endpoint
 * - unknown fields               → dropped (parse loads what it can; the JSON
 *                                  Schema layer reports them)
 *
 * Deviation from v7 (per ADR D10/D11): links whose endpoints do not resolve
 * to a device/provider network are PRESERVED, not dropped — validate()
 * reports them as dangling references. v7 silently discarded them, which
 * would destroy agent edits on the next save.
 */

import type {
  Cable,
  Circuit,
  ConfigContext,
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

export class TopoParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopoParseError';
  }
}

/** Parse `*.topo.json` text into a canonical Topology. Throws TopoParseError. */
export function parse(text: string): Topology {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new TopoParseError(`invalid JSON: ${(e as Error).message}`);
  }
  return normalize(value);
}

/** Normalize an already-parsed JSON value into a canonical Topology. */
export function normalize(value: unknown): Topology {
  if (!isPlainObject(value)) {
    throw new TopoParseError('top level must be a JSON object');
  }
  if (!Array.isArray(value.devices)) {
    throw new TopoParseError('no "devices" array found');
  }
  if ('version' in value && value.version !== undefined && value.version !== 1) {
    throw new TopoParseError(
      `unsupported version ${JSON.stringify(value.version)} (this build reads format v1)`,
    );
  }

  const devices = value.devices
    .map((raw, i) => normalizeDevice(raw, i))
    .filter((d): d is Device => d !== undefined);
  const provider_networks = asArray(value.provider_networks)
    .map((raw, i) => normalizeProviderNetwork(raw, i))
    .filter((p): p is ProviderNetwork => p !== undefined);
  const networks = asArray(value.networks)
    .map((raw, i) => normalizeNetwork(raw, i))
    .filter((n): n is Network => n !== undefined);

  const cables = asArray(value.cables)
    .filter(isPlainObject)
    .map((raw) => normalizeCable(raw));
  const circuits = asArray(value.circuits)
    .filter(isPlainObject)
    .map((raw) => normalizeCircuit(raw));
  const logical_links = asArray(value.logical_links)
    .filter(isPlainObject)
    .map((raw) => normalizeLogicalLink(raw, devices));

  const topology: Topology = { devices };
  const schema = nonEmptyString(value.$schema);
  if (schema !== undefined) topology.$schema = schema;
  if (value.version === 1) topology.version = 1;
  if (provider_networks.length) topology.provider_networks = provider_networks;
  if (networks.length) topology.networks = networks;
  if (cables.length) topology.cables = cables;
  if (circuits.length) topology.circuits = circuits;
  if (logical_links.length) topology.logical_links = logical_links;
  // Reassemble in canonical key order for stable deep-equality in tests.
  return reorderTopology(topology);
}

/* ---------- helpers ---------- */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function trimmedString(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

function normalizePosition(v: unknown): Position | undefined {
  if (!isPlainObject(v)) return undefined;
  const x = v.x;
  const y = v.y;
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: Math.round(x), y: Math.round(y) };
}

function normalizeInterface(raw: unknown): DeviceInterface | undefined {
  if (!isPlainObject(raw)) return undefined;
  const f: DeviceInterface = {};
  const name = nonEmptyString(raw.name);
  const ip = nonEmptyString(raw.ip_address);
  const type = nonEmptyString(raw.type);
  const description = nonEmptyString(raw.description);
  const lag = nonEmptyString(raw.lag);
  const vrf = nonEmptyString(raw.vrf);
  if (name !== undefined) f.name = name;
  if (ip !== undefined) f.ip_address = ip;
  if (type !== undefined) f.type = type;
  if (description !== undefined) f.description = description;
  if (lag !== undefined) f.lag = lag;
  if (vrf !== undefined) f.vrf = vrf;
  // Fully-empty interfaces are dropped (v7 clean() did this on export).
  return Object.keys(f).length ? f : undefined;
}

function normalizeDevice(raw: unknown, index: number): Device | undefined {
  if (!isPlainObject(raw)) return undefined;
  const d: Device = {
    name: nonEmptyString(raw.name) ?? `node-${index + 1}`,
  };
  const device_type = nonEmptyString(raw.device_type);
  const role = nonEmptyString(raw.role);
  const site = nonEmptyString(raw.site);
  const tenant = nonEmptyString(raw.tenant);
  const platform = nonEmptyString(raw.platform);
  if (device_type !== undefined) d.device_type = device_type;
  if (role !== undefined) d.role = role;
  if (site !== undefined) d.site = site;
  if (tenant !== undefined) d.tenant = tenant;
  if (platform !== undefined) d.platform = platform;

  const vrfs = asArray(raw.vrfs)
    .map((v) => String(v).trim())
    .filter(Boolean);
  if (vrfs.length) d.vrfs = vrfs;

  const interfaces = asArray(raw.interfaces)
    .map(normalizeInterface)
    .filter((f): f is DeviceInterface => f !== undefined);
  if (interfaces.length) d.interfaces = interfaces;

  // config_context: top level must be an object; preserved verbatim
  // (empty values inside are NOT pruned); empty object is omitted.
  if (isPlainObject(raw.config_context) && Object.keys(raw.config_context).length) {
    d.config_context = raw.config_context as ConfigContext;
  }

  const position = normalizePosition(raw.position);
  if (position) d.position = position;
  return d;
}

function normalizeProviderNetwork(raw: unknown, index: number): ProviderNetwork | undefined {
  if (!isPlainObject(raw)) return undefined;
  const p: ProviderNetwork = {
    name: nonEmptyString(raw.name) ?? `pnet-${index + 1}`,
  };
  const provider = nonEmptyString(raw.provider);
  const description = nonEmptyString(raw.description);
  if (provider !== undefined) p.provider = provider;
  if (description !== undefined) p.description = description;
  const position = normalizePosition(raw.position);
  if (position) p.position = position;
  return p;
}

function normalizeNetwork(raw: unknown, index: number): Network | undefined {
  if (!isPlainObject(raw)) return undefined;
  const n: Network = {
    name: nonEmptyString(raw.name) ?? `net-${index + 1}`,
  };
  const prefix = nonEmptyString(raw.prefix);
  const vlan = nonEmptyString(raw.vlan);
  const description = nonEmptyString(raw.description);
  if (prefix !== undefined) n.prefix = prefix;
  if (vlan !== undefined) n.vlan = vlan;
  if (isPlainObject(raw.fhrp)) {
    const fhrp: FhrpConfig = {};
    const protocol = nonEmptyString(raw.fhrp.protocol);
    // 'group' was renamed to NetBox's 'group_id' (2026-07-06); absorb the old name
    const group_id = nonEmptyString(raw.fhrp.group_id) ?? nonEmptyString(raw.fhrp.group);
    const virtual_ip = nonEmptyString(raw.fhrp.virtual_ip);
    if (protocol !== undefined) fhrp.protocol = protocol;
    if (group_id !== undefined) fhrp.group_id = group_id;
    if (virtual_ip !== undefined) fhrp.virtual_ip = virtual_ip;
    if (Object.keys(fhrp).length) n.fhrp = fhrp;
  }
  if (description !== undefined) n.description = description;
  const position = normalizePosition(raw.position);
  if (position) n.position = position;
  return n;
}

function normalizePhysicalEndpoint(raw: unknown, keepSite: boolean): PhysicalEndpoint {
  if (!isPlainObject(raw)) return {};
  const pn = nonEmptyString(raw.provider_network);
  if (pn !== undefined) return { provider_network: pn };
  const ep: PhysicalEndpoint = {};
  // The site of a circuit endpoint is informational; serialize() re-derives it
  // from the device whenever the reference resolves. It is kept on the model
  // so it survives for dangling references.
  const site = keepSite ? nonEmptyString(raw.site) : undefined;
  const device = nonEmptyString(raw.device);
  const iface = nonEmptyString(raw.interface);
  if (site !== undefined) ep.site = site;
  if (device !== undefined) ep.device = device;
  if (iface !== undefined) ep.interface = iface;
  return ep;
}

function normalizeCable(raw: Record<string, unknown>): Cable {
  const c: Cable = {
    a: normalizePhysicalEndpoint(raw.a, false),
    b: normalizePhysicalEndpoint(raw.b, false),
  };
  const type = nonEmptyString(raw.type);
  const bandwidth = nonEmptyString(raw.bandwidth);
  const status = nonEmptyString(raw.status);
  const label = nonEmptyString(raw.label);
  if (type !== undefined) c.type = type;
  if (bandwidth !== undefined) c.bandwidth = bandwidth;
  if (status !== undefined) c.status = status;
  if (label !== undefined) c.label = label;
  return c;
}

function normalizeCircuit(raw: Record<string, unknown>): Circuit {
  const c: Circuit = {
    a: normalizePhysicalEndpoint(raw.a, true),
    b: normalizePhysicalEndpoint(raw.b, true),
  };
  const cid = nonEmptyString(raw.cid);
  const provider = nonEmptyString(raw.provider);
  const type = nonEmptyString(raw.type);
  const commit_rate = nonEmptyString(raw.commit_rate);
  const status = nonEmptyString(raw.status);
  if (cid !== undefined) c.cid = cid;
  if (provider !== undefined) c.provider = provider;
  if (type !== undefined) c.type = type;
  if (commit_rate !== undefined) c.commit_rate = commit_rate;
  if (status !== undefined) c.status = status;
  return c;
}

/** Append-or-find an interface by name on a device (ported from v7 ensureIf). */
function ensureInterface(device: Device, name: string): DeviceInterface {
  device.interfaces = device.interfaces ?? [];
  let f = device.interfaces.find((x) => x.name === name);
  if (!f) {
    f = { name };
    device.interfaces.push(f);
  }
  return f;
}

function normalizeLogicalEndpoint(
  raw: unknown,
  topLevelVrf: string | undefined,
  devices: Device[],
): LogicalEndpoint {
  if (!isPlainObject(raw)) return {};
  const pn = nonEmptyString(raw.provider_network);
  if (pn !== undefined) {
    const ep: LogicalEndpoint = { provider_network: pn };
    const id = trimmedString(raw.id);
    if (id !== undefined) ep.id = id;
    return ep;
  }
  const net = nonEmptyString(raw.network);
  if (net !== undefined) return { network: net };
  const ep: LogicalEndpoint = {};
  const device = nonEmptyString(raw.device);
  // v3 back-compat: a single top-level "vrf" on the link applies to both ends.
  const vrf = trimmedString(raw.vrf) ?? topLevelVrf;
  const id = trimmedString(raw.id);
  const iface = nonEmptyString(raw.interface);
  const ip = nonEmptyString(raw.ip_address);
  if (device !== undefined) ep.device = device;
  if (vrf !== undefined) ep.vrf = vrf;
  if (id !== undefined) ep.id = id;
  if (iface !== undefined) ep.interface = iface;

  const target =
    device !== undefined ? devices.find((d) => d.name === device) : undefined;
  if (iface !== undefined && ip !== undefined && target) {
    // IP write-through (spec §3.8-B / §7, ported from v7 epIfWrite): the IP
    // moves onto the device-side interface if that interface has no IP yet.
    // When the interface already carries an IP, the endpoint copy is dropped
    // (spec §7: written "if no existing value") — v7 behavior. Either way the
    // endpoint does not keep the IP once an interface is named on a resolved
    // device.
    const f = ensureInterface(target, iface);
    if (!f.ip_address) f.ip_address = ip;
    if (vrf !== undefined && !f.vrf) f.vrf = vrf;
  } else if (ip !== undefined) {
    // The endpoint keeps its IP when there is no interface (spec §3.8-B),
    // and — unlike v7, which dropped the whole link — when the device
    // reference is dangling, so no data is destroyed on unresolved
    // references (ADR D10/D11).
    ep.ip_address = ip;
  }
  return ep;
}

function normalizeLogicalLink(raw: Record<string, unknown>, devices: Device[]): LogicalLink {
  const topLevelVrf = trimmedString(raw.vrf);
  const l: LogicalLink = {
    a: normalizeLogicalEndpoint(raw.a, topLevelVrf, devices),
    b: normalizeLogicalEndpoint(raw.b, topLevelVrf, devices),
  };
  const link_id = nonEmptyString(raw.link_id);
  const vlan = nonEmptyString(raw.vlan);
  const label = nonEmptyString(raw.label);
  const description = nonEmptyString(raw.description);
  if (link_id !== undefined) l.link_id = link_id;
  if (vlan !== undefined) l.vlan = vlan;
  if (label !== undefined) l.label = label;
  if (description !== undefined) l.description = description;
  return l;
}

function reorderTopology(t: Topology): Topology {
  const out: Topology = {} as Topology;
  if (t.$schema !== undefined) out.$schema = t.$schema;
  if (t.version !== undefined) out.version = t.version;
  out.devices = t.devices;
  if (t.provider_networks) out.provider_networks = t.provider_networks;
  if (t.networks) out.networks = t.networks;
  if (t.cables) out.cables = t.cables;
  if (t.circuits) out.circuits = t.circuits;
  if (t.logical_links) out.logical_links = t.logical_links;
  return out;
}
