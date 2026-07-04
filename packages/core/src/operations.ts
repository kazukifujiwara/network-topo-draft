/**
 * Pure model operations (plan §4.1): every function takes a Topology and
 * returns a NEW Topology — the input is never mutated. The Webview applies
 * these on canvas commits and serializes the result (plan §4.2); undo/redo is
 * VSCode's document history (ADR D6), so no history lives here.
 *
 * Ported from the frozen v7 reference (newDevice, uniqueName, deleteSelection,
 * alignRow/alignCol/distH/distV, autoLayout, and the logical-link panel's
 * endpoint semantics).
 */

import type {
  Cable,
  Circuit,
  Device,
  LogicalLink,
  ProviderNetwork,
  Topology,
} from './model';
import { deepClone, findDevice, iconKey, siteOf } from './model';
import { snap } from './geometry';

/* ---------- naming ---------- */

function allNodeNames(topology: Topology): Set<string> {
  const s = new Set<string>(topology.devices.map((d) => d.name));
  for (const p of topology.provider_networks ?? []) s.add(p.name);
  return s;
}

/** First free name: base, base-2, base-3, … (v7 `uniqueName`). */
export function uniqueName(topology: Topology, base: string): string {
  const names = allNodeNames(topology);
  let n = base;
  let i = 2;
  while (names.has(n)) n = `${base}-${i++}`;
  return n;
}

/* ---------- add / delete ---------- */

const BASE_NAME: Record<string, string> = {
  router: 'rt-01',
  switch: 'sw-01',
  firewall: 'fw-01',
  cloud: 'ext-01',
  server: 'srv-01',
  generic: 'node-01',
};

export interface AddResult {
  topology: Topology;
  /** Name assigned to the new node. */
  name: string;
}

/** Add a device with a role-derived default name at (x, y) (v7 `newDevice`). */
export function addDevice(topology: Topology, role: string, x: number, y: number): AddResult {
  const name = uniqueName(topology, BASE_NAME[iconKey(role)] ?? 'node-01');
  const device: Device = { name };
  if (role) device.role = role;
  device.position = { x: snap(x), y: snap(y) };
  const next = deepClone(topology);
  next.devices.push(device);
  return { topology: next, name };
}

export function addProviderNetwork(topology: Topology, x: number, y: number): AddResult {
  const name = uniqueName(topology, 'pnet-01');
  const next = deepClone(topology);
  next.provider_networks = next.provider_networks ?? [];
  next.provider_networks.push({ name, position: { x: snap(x), y: snap(y) } });
  return { topology: next, name };
}

export function addCable(topology: Topology, cable: Cable): Topology {
  const next = deepClone(topology);
  next.cables = next.cables ?? [];
  next.cables.push(deepClone(cable));
  return next;
}

export function addCircuit(topology: Topology, circuit: Circuit): Topology {
  const next = deepClone(topology);
  next.circuits = next.circuits ?? [];
  next.circuits.push(deepClone(circuit));
  return next;
}

export function addLogicalLink(topology: Topology, link: LogicalLink): Topology {
  const next = deepClone(topology);
  next.logical_links = next.logical_links ?? [];
  next.logical_links.push(deepClone(link));
  return next;
}

/**
 * Delete devices/provider networks by name, removing every link attached to
 * them (v7 `deleteSelection`). Links between two surviving nodes — including
 * links with dangling references to other names — are preserved.
 */
export function deleteNodes(topology: Topology, names: string[]): Topology {
  const doomed = new Set(names);
  const next = deepClone(topology);
  next.devices = next.devices.filter((d) => !doomed.has(d.name));
  if (next.provider_networks) {
    next.provider_networks = next.provider_networks.filter((p) => !doomed.has(p.name));
    if (!next.provider_networks.length) delete next.provider_networks;
  }
  const attached = (ep: { device?: string; provider_network?: string }): boolean =>
    (ep.device !== undefined && doomed.has(ep.device)) ||
    (ep.provider_network !== undefined && doomed.has(ep.provider_network));
  if (next.cables) {
    next.cables = next.cables.filter((l) => !attached(l.a) && !attached(l.b));
    if (!next.cables.length) delete next.cables;
  }
  if (next.circuits) {
    next.circuits = next.circuits.filter((l) => !attached(l.a) && !attached(l.b));
    if (!next.circuits.length) delete next.circuits;
  }
  if (next.logical_links) {
    next.logical_links = next.logical_links.filter((l) => !attached(l.a) && !attached(l.b));
    if (!next.logical_links.length) delete next.logical_links;
  }
  return next;
}

export function deleteLink(
  topology: Topology,
  collection: 'cables' | 'circuits' | 'logical_links',
  index: number,
): Topology {
  const next = deepClone(topology);
  const arr = next[collection];
  if (arr && index >= 0 && index < arr.length) {
    arr.splice(index, 1);
    if (!arr.length) delete next[collection];
  }
  return next;
}

/* ---------- rename with reference-following (ADR D10) ---------- */

/**
 * Rename a device and update every link endpoint that references it by name.
 * The new name is applied as given — uniqueness is the caller's concern and
 * duplicate names surface via validate().
 */
export function renameDevice(topology: Topology, oldName: string, newName: string): Topology {
  const next = deepClone(topology);
  const device = findDevice(next, oldName);
  if (!device || oldName === newName) return next;
  device.name = newName;
  for (const links of [next.cables ?? [], next.circuits ?? []]) {
    for (const l of links) {
      if (l.a.device === oldName) l.a.device = newName;
      if (l.b.device === oldName) l.b.device = newName;
    }
  }
  for (const l of next.logical_links ?? []) {
    if (l.a.device === oldName) l.a.device = newName;
    if (l.b.device === oldName) l.b.device = newName;
  }
  return next;
}

/** Rename a provider network and update circuit/logical endpoint references. */
export function renameProviderNetwork(
  topology: Topology,
  oldName: string,
  newName: string,
): Topology {
  const next = deepClone(topology);
  const pn = (next.provider_networks ?? []).find((p) => p.name === oldName);
  if (!pn || oldName === newName) return next;
  pn.name = newName;
  for (const l of [...(next.cables ?? []), ...(next.circuits ?? [])]) {
    if (l.a.provider_network === oldName) l.a.provider_network = newName;
    if (l.b.provider_network === oldName) l.b.provider_network = newName;
  }
  for (const l of next.logical_links ?? []) {
    if (l.a.provider_network === oldName) l.a.provider_network = newName;
    if (l.b.provider_network === oldName) l.b.provider_network = newName;
  }
  return next;
}

/** Move every device on a site to a new site name (v7 site inline-rename). */
export function renameSite(topology: Topology, oldSite: string, newSite: string): Topology {
  const next = deepClone(topology);
  for (const d of next.devices) {
    if (siteOf(d) === oldSite) {
      if (newSite) d.site = newSite;
      else delete d.site;
    }
  }
  return next;
}

/* ---------- logical-endpoint semantics (v7 link panel) ---------- */

/**
 * Set the interface of a logical endpoint. When the endpoint holds an IP and
 * an interface is now named, the IP (and the endpoint VRF, if the interface
 * has none) migrates onto the device-side interface — created if missing —
 * and leaves the endpoint (v7 `data-epi` change handler).
 */
export function setLogicalEndpointInterface(
  topology: Topology,
  linkIndex: number,
  side: 'a' | 'b',
  interfaceName: string,
): Topology {
  const next = deepClone(topology);
  const link = (next.logical_links ?? [])[linkIndex];
  if (!link) return next;
  const ep = link[side];
  if (interfaceName) ep.interface = interfaceName;
  else delete ep.interface;
  const device = ep.device !== undefined ? findDevice(next, ep.device) : undefined;
  if (device && interfaceName && (ep.ip_address ?? '').trim()) {
    const f = ensureInterface(device, interfaceName);
    if (!f.ip_address) f.ip_address = ep.ip_address;
    const v = (ep.vrf ?? '').trim();
    if (v && !f.vrf) f.vrf = v;
    delete ep.ip_address;
  }
  return next;
}

/**
 * Set the IP of a logical endpoint. With an interface named on a resolvable
 * device, the IP is written through to that device interface (created if
 * missing; the endpoint VRF overwrites the interface VRF when set) — without
 * one, the IP stays on the endpoint (v7 `data-epip` input handler).
 */
export function setLogicalEndpointIp(
  topology: Topology,
  linkIndex: number,
  side: 'a' | 'b',
  ip: string,
): Topology {
  const next = deepClone(topology);
  const link = (next.logical_links ?? [])[linkIndex];
  if (!link) return next;
  const ep = link[side];
  const device = ep.device !== undefined ? findDevice(next, ep.device) : undefined;
  if (device && ep.interface !== undefined) {
    const f = ensureInterface(device, ep.interface);
    if (ip) f.ip_address = ip;
    else delete f.ip_address;
    const v = (ep.vrf ?? '').trim();
    if (v) f.vrf = v;
  } else if (ip) {
    ep.ip_address = ip;
  } else {
    delete ep.ip_address;
  }
  return next;
}

function ensureInterface(device: Device, name: string) {
  device.interfaces = device.interfaces ?? [];
  let f = device.interfaces.find((x) => x.name === name);
  if (!f) {
    f = { name };
    device.interfaces.push(f);
  }
  return f;
}

/* ---------- clipboard / paste / duplicate (v7 copySel/pasteClip) ---------- */

/**
 * A self-contained copy of nodes plus the links BETWEEN them (links to
 * outside nodes are not copied — v7 behavior). Survives later edits or
 * deletion of the originals.
 */
export interface TopoClipboard {
  devices: Device[];
  provider_networks: ProviderNetwork[];
  cables: Cable[];
  circuits: Circuit[];
  logical_links: LogicalLink[];
}

export function makeClipboard(topology: Topology, names: string[]): TopoClipboard {
  const wanted = new Set(names);
  const devices = topology.devices.filter((d) => wanted.has(d.name));
  const provider_networks = (topology.provider_networks ?? []).filter((p) => wanted.has(p.name));
  const copied = new Set([...devices, ...provider_networks].map((n) => n.name));
  const inside = (ep: { device?: string; provider_network?: string }): boolean => {
    const ref = ep.provider_network ?? ep.device;
    return ref !== undefined && copied.has(ref);
  };
  return deepClone({
    devices,
    provider_networks,
    cables: (topology.cables ?? []).filter((l) => inside(l.a) && inside(l.b)),
    circuits: (topology.circuits ?? []).filter((l) => inside(l.a) && inside(l.b)),
    logical_links: (topology.logical_links ?? []).filter((l) => inside(l.a) && inside(l.b)),
  });
}

export interface PasteResult {
  topology: Topology;
  /** old name → new (unique) name of every pasted node */
  renames: Map<string, string>;
}

/**
 * Paste a clipboard: every node gets a fresh unique name, pasted links are
 * re-pointed at the new names, and positions shift so the clipboard's
 * top-left lands at (atX, atY) (v7 pasteClip).
 */
export function pasteClipboard(
  topology: Topology,
  clipboard: TopoClipboard,
  atX: number,
  atY: number,
  snapOn = true,
): PasteResult {
  const next = deepClone(topology);
  const clip = deepClone(clipboard);
  const nodes = [...clip.devices, ...clip.provider_networks];
  if (!nodes.length) return { topology: next, renames: new Map() };
  const minX = Math.min(...nodes.map((n) => n.position?.x ?? 0));
  const minY = Math.min(...nodes.map((n) => n.position?.y ?? 0));
  const renames = new Map<string, string>();
  const place = (n: Device | ProviderNetwork): void => {
    const fresh = uniqueName(next, n.name || 'node');
    renames.set(n.name, fresh);
    n.name = fresh;
    n.position = {
      x: snap(atX + (n.position?.x ?? 0) - minX, snapOn),
      y: snap(atY + (n.position?.y ?? 0) - minY, snapOn),
    };
  };
  for (const d of clip.devices) {
    place(d);
    next.devices.push(d);
  }
  for (const p of clip.provider_networks) {
    place(p);
    next.provider_networks = next.provider_networks ?? [];
    next.provider_networks.push(p);
  }
  const remap = (ep: { device?: string; provider_network?: string }): void => {
    if (ep.device !== undefined && renames.has(ep.device)) {
      ep.device = renames.get(ep.device) as string;
    }
    if (ep.provider_network !== undefined && renames.has(ep.provider_network)) {
      ep.provider_network = renames.get(ep.provider_network) as string;
    }
  };
  for (const l of clip.cables) {
    remap(l.a);
    remap(l.b);
    next.cables = next.cables ?? [];
    next.cables.push(l);
  }
  for (const l of clip.circuits) {
    remap(l.a);
    remap(l.b);
    next.circuits = next.circuits ?? [];
    next.circuits.push(l);
  }
  for (const l of clip.logical_links) {
    remap(l.a);
    remap(l.b);
    next.logical_links = next.logical_links ?? [];
    next.logical_links.push(l);
  }
  return { topology: next, renames };
}

/* ---------- cable ⇄ circuit conversion (v7 context menu) ---------- */

/**
 * Convert a cable to a circuit (or back), keeping the fields both shapes
 * share (a, b, type, status). Fields the target shape cannot hold are lost —
 * exactly what v7's unified in-memory link lost on its next export. The link
 * is appended to the end of the target collection.
 */
export function convertCableToCircuit(topology: Topology, index: number): Topology {
  const next = deepClone(topology);
  const cable = (next.cables ?? [])[index];
  if (!cable) return next;
  (next.cables as Cable[]).splice(index, 1);
  if (!next.cables?.length) delete next.cables;
  const circuit: Circuit = { a: cable.a, b: cable.b };
  if (cable.type !== undefined) circuit.type = cable.type;
  if (cable.status !== undefined) circuit.status = cable.status;
  next.circuits = next.circuits ?? [];
  next.circuits.push(circuit);
  return next;
}

export function convertCircuitToCable(topology: Topology, index: number): Topology {
  const next = deepClone(topology);
  const circuit = (next.circuits ?? [])[index];
  if (!circuit) return next;
  (next.circuits as Circuit[]).splice(index, 1);
  if (!next.circuits?.length) delete next.circuits;
  const strip = (ep: Circuit['a']): Cable['a'] =>
    ep.provider_network !== undefined
      ? { provider_network: ep.provider_network }
      : {
          ...(ep.device !== undefined ? { device: ep.device } : {}),
          ...(ep.interface !== undefined ? { interface: ep.interface } : {}),
        };
  const cable: Cable = { a: strip(circuit.a), b: strip(circuit.b) };
  if (circuit.type !== undefined) cable.type = circuit.type;
  if (circuit.status !== undefined) cable.status = circuit.status;
  next.cables = next.cables ?? [];
  next.cables.push(cable);
  return next;
}

/* ---------- arrange (v7 alignRow/alignCol/distH/distV) ---------- */

type Node = Device | ProviderNetwork;

function nodesByName(topology: Topology, names: string[]): Node[] {
  const all: Node[] = [...topology.devices, ...(topology.provider_networks ?? [])];
  return names
    .map((n) => all.find((d) => d.name === n))
    .filter((d): d is Node => d !== undefined);
}

function pos(n: Node): { x: number; y: number } {
  n.position = n.position ?? { x: 0, y: 0 };
  return n.position;
}

/** Same Y for all selected nodes (mean, snapped). Needs ≥ 2 nodes. */
export function alignRow(topology: Topology, names: string[], snapOn = true): Topology {
  const next = deepClone(topology);
  const ds = nodesByName(next, names);
  if (ds.length < 2) return next;
  const y = snap(Math.round(ds.reduce((s, d) => s + pos(d).y, 0) / ds.length), snapOn);
  ds.forEach((d) => (pos(d).y = y));
  return next;
}

/** Same X for all selected nodes (mean, snapped). Needs ≥ 2 nodes. */
export function alignCol(topology: Topology, names: string[], snapOn = true): Topology {
  const next = deepClone(topology);
  const ds = nodesByName(next, names);
  if (ds.length < 2) return next;
  const x = snap(Math.round(ds.reduce((s, d) => s + pos(d).x, 0) / ds.length), snapOn);
  ds.forEach((d) => (pos(d).x = x));
  return next;
}

/** Even horizontal spacing between the leftmost and rightmost node. Needs ≥ 3. */
export function distributeH(topology: Topology, names: string[], snapOn = true): Topology {
  const next = deepClone(topology);
  const ds = nodesByName(next, names).sort((a, b) => pos(a).x - pos(b).x);
  if (ds.length < 3) return next;
  const first = pos(ds[0] as Node).x;
  const last = pos(ds[ds.length - 1] as Node).x;
  const step = (last - first) / (ds.length - 1);
  ds.forEach((d, i) => (pos(d).x = snap(first + step * i, snapOn)));
  return next;
}

/** Even vertical spacing between the topmost and bottommost node. Needs ≥ 3. */
export function distributeV(topology: Topology, names: string[], snapOn = true): Topology {
  const next = deepClone(topology);
  const ds = nodesByName(next, names).sort((a, b) => pos(a).y - pos(b).y);
  if (ds.length < 3) return next;
  const first = pos(ds[0] as Node).y;
  const last = pos(ds[ds.length - 1] as Node).y;
  const step = (last - first) / (ds.length - 1);
  ds.forEach((d, i) => (pos(d).y = snap(first + step * i, snapOn)));
  return next;
}

/* ---------- initial auto-placement (v7 autoLayout) ---------- */

/**
 * Grid-place ALL nodes grouped by site (plan §3: only the initial placement
 * when a file has no positions; there is no "tidy" re-layout). Nodes without
 * a site — including provider networks — form one group. Group and in-group
 * order follow the arrays, so the result is deterministic.
 */
export function autoLayout(topology: Topology): Topology {
  const next = deepClone(topology);
  const nodes: Node[] = [...next.devices, ...(next.provider_networks ?? [])];
  if (!nodes.length) return next;
  const groups = new Map<string, Node[]>();
  for (const n of nodes) {
    const s = 'site' in n ? siteOf(n as Device) || ' ' : ' ';
    if (!groups.has(s)) groups.set(s, []);
    (groups.get(s) as Node[]).push(n);
  }
  const entries = [...groups.values()];
  const CELL_W = 210;
  const CELL_H = 130;
  const GAP = 100;
  const PAD = 44;
  const perRow = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
  let gx = 0;
  let gy = 0;
  let rowH = 0;
  let col = 0;
  for (const ds of entries) {
    const cols = Math.ceil(Math.sqrt(ds.length));
    ds.forEach((d, i) => {
      d.position = {
        x: gx + PAD + (i % cols) * CELL_W,
        y: gy + PAD + Math.floor(i / cols) * CELL_H,
      };
    });
    const w = PAD * 2 + cols * CELL_W;
    const h = PAD * 2 + Math.ceil(ds.length / cols) * CELL_H;
    rowH = Math.max(rowH, h);
    col++;
    if (col >= perRow) {
      col = 0;
      gx = 0;
      gy += rowH + GAP;
      rowH = 0;
    } else {
      gx += w + GAP;
    }
  }
  return next;
}

/** True when any node lacks a position (the extension then runs autoLayout on open). */
export function needsAutoLayout(topology: Topology): boolean {
  return [...topology.devices, ...(topology.provider_networks ?? [])].some(
    (n) => n.position === undefined,
  );
}
