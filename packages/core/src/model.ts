/**
 * Data model for format v1 (`*.topo.json`).
 *
 * The types mirror the file format exactly (docs/topodraft-file-format-v1.md
 * §3): a Topology value produced by parse() is already canonical — legacy
 * shapes absorbed, empty fields omitted — so serialize() only has to order
 * keys and print.
 */

export interface Position {
  x: number;
  y: number;
}

/** interfaces[] under a device (spec §3.2). */
export interface DeviceInterface {
  name?: string;
  ip_address?: string;
  type?: string;
  description?: string;
  lag?: string;
  vrf?: string;
}

/** Free-form structured settings; top level must be an object (spec §3.3). */
export type ConfigContext = { [key: string]: unknown };

/** devices[] (≈ NetBox Device, spec §3.1). */
export interface Device {
  name: string;
  device_type?: string;
  role?: string;
  site?: string;
  tenant?: string;
  platform?: string;
  vrfs?: string[];
  interfaces?: DeviceInterface[];
  config_context?: ConfigContext;
  position?: Position;
}

/** provider_networks[] (≈ NetBox Provider Network, spec §3.4). */
export interface ProviderNetwork {
  name: string;
  provider?: string;
  description?: string;
  position?: Position;
}

/** Physical endpoint for cables/circuits (spec §3.8-A). */
export interface PhysicalEndpoint {
  site?: string;
  device?: string;
  interface?: string;
  provider_network?: string;
}

/** Logical endpoint for logical_links (spec §3.8-B). */
export interface LogicalEndpoint {
  device?: string;
  vrf?: string;
  id?: string;
  interface?: string;
  ip_address?: string;
  provider_network?: string;
}

export interface Cable {
  a: PhysicalEndpoint;
  b: PhysicalEndpoint;
  type?: string;
  bandwidth?: string;
  status?: string;
  label?: string;
}

export interface Circuit {
  a: PhysicalEndpoint;
  b: PhysicalEndpoint;
  cid?: string;
  provider?: string;
  type?: string;
  commit_rate?: string;
  status?: string;
}

export interface LogicalLink {
  a: LogicalEndpoint;
  b: LogicalEndpoint;
  link_id?: string;
  vlan?: string;
  label?: string;
  description?: string;
}

export interface Topology {
  $schema?: string;
  /**
   * Fixed to 1 in format v1. Absent means the file was a legacy (pre-v1)
   * export not yet normalized: parse() preserves the absence so validate()
   * can report it (Info), and serialize() always writes `version: 1`
   * (spec §7 "normalized on the next save").
   */
  version?: 1;
  devices: Device[];
  provider_networks?: ProviderNetwork[];
  cables?: Cable[];
  circuits?: Circuit[];
  logical_links?: LogicalLink[];
}

/* ---------- lookups ---------- */

/** First device with the given name (references resolve to the first occurrence). */
export function findDevice(topology: Topology, name: string): Device | undefined {
  return topology.devices.find((d) => d.name === name);
}

export function findProviderNetwork(
  topology: Topology,
  name: string,
): ProviderNetwork | undefined {
  return (topology.provider_networks ?? []).find((p) => p.name === name);
}

/** Trimmed site of a device; '' when unset. */
export function siteOf(device: Device): string {
  return (device.site ?? '').trim();
}

/** Unique non-empty device sites, in first-appearance order. */
export function sitesList(topology: Topology): string[] {
  return [...new Set(topology.devices.map(siteOf).filter(Boolean))];
}

/* ---------- VRF derivation (spec §3.9) ---------- */

/**
 * VRF instances of a device: explicit `vrfs[]` ∪ `interfaces[].vrf` ∪
 * `vrf` of logical-link endpoints terminating on that device — in that
 * insertion order (matches v7 `devVrfs`).
 */
export function deriveDeviceVrfs(topology: Topology, deviceName: string): string[] {
  const device = findDevice(topology, deviceName);
  if (!device) return [];
  const s = new Set(
    (device.vrfs ?? []).map((v) => v.trim()).filter(Boolean),
  );
  for (const f of device.interfaces ?? []) {
    const v = (f.vrf ?? '').trim();
    if (v) s.add(v);
  }
  for (const l of topology.logical_links ?? []) {
    for (const ep of [l.a, l.b]) {
      if (ep.device === deviceName) {
        const v = (ep.vrf ?? '').trim();
        if (v) s.add(v);
      }
    }
  }
  return [...s];
}

/** All VRFs across every device, in device order (matches v7 `allVrfs`). */
export function allVrfs(topology: Topology): string[] {
  const s = new Set<string>();
  for (const d of topology.devices) {
    for (const v of deriveDeviceVrfs(topology, d.name)) s.add(v);
  }
  return [...s];
}

/* ---------- role classification (ported from v7 iconKey) ---------- */

export type IconKey =
  | 'router'
  | 'switch'
  | 'firewall'
  | 'cloud'
  | 'server'
  | 'generic'
  | 'pnet';

export function iconKey(role: string | undefined): IconKey {
  const r = (role ?? '').toLowerCase();
  if (/fw|firewall|utm|waf/.test(r)) return 'firewall';
  if (/sw|switch|l2|l3|fabric/.test(r)) return 'switch';
  if (/rt|router|gw|gateway|edge|core/.test(r)) return 'router';
  if (/cloud|external|internet|peer|isp|wan|saas|aws|oci|azure|gcp/.test(r)) return 'cloud';
  if (/server|srv|host|vm|lb|balancer/.test(r)) return 'server';
  return 'generic';
}

/* ---------- misc ---------- */

/**
 * Deep clone for topology values. All model values are JSON-safe by
 * construction, so a JSON round-trip is sufficient — and it keeps the code
 * on the plain ES2020 lib surface.
 */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
