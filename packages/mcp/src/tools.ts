/**
 * Pure tool logic for the TopoDraft MCP server (#11): text in, structured
 * results out. SDK assembly lives in server.ts and the process wiring
 * (fs, stdio transport) in mcp.ts — the same layering as the CLI (run.ts),
 * so everything here is unit-testable.
 *
 * Purpose (product vision): AI agents co-edit *.topo.json files as text.
 * These tools give any MCP client the same three primitives the editor
 * relies on — learn the format, read a topology, validate it — without
 * hand-crafting JSON or guessing field names.
 */
import {
  addCable,
  addCircuit,
  addDevice,
  addLogicalLink,
  allVrfs,
  deleteLink,
  deleteNodes,
  findDevice,
  genSchemaDoc,
  genSvg,
  parse,
  renameDevice,
  serialize,
  sitesList,
  toCanonical,
} from '@topodraft/core';
import type {
  Cable,
  Circuit,
  Device,
  DeviceInterface,
  LogicalLink,
  SvgOptions,
  Topology,
} from '@topodraft/core';
import { validateText } from '../../cli/src/run';
import type { CliDiagnostic } from '../../cli/src/run';

export type { CliDiagnostic } from '../../cli/src/run';

/** The canonical topology file extensions (spec: *.topo.json, alias *.topo). */
export const TOPO_FILE_RE = /\.topo(\.json)?$/;

/**
 * Tool metadata in one place so the vendor-name guard test can scan every
 * string an MCP client will see (same policy as templates / agent guide).
 */
export const TOOL_DOCS = {
  describe_format: {
    title: 'Describe the TopoDraft file format',
    description:
      'Returns the TopoDraft topology file format contract: editing rules, the published ' +
      'JSON Schema, and a minimal example for *.topo.json files. Read this once before ' +
      'writing or editing a topology file.',
  },
  read_topology: {
    title: 'Read a topology file',
    description:
      'Parses a *.topo.json / *.topo file and returns a summary (device/link counts, ' +
      'sites, VRFs, diagnostic counts) plus the canonical topology JSON.',
    pathDescription: 'Path to the topology file (*.topo.json or *.topo)',
  },
  validate_topology: {
    title: 'Validate a topology file',
    description:
      'Validates a *.topo.json / *.topo file and returns the same diagnostics as the ' +
      'editor: JSON syntax, topology shape, semantic rules, and unknown-field ' +
      'did-you-mean suggestions. Run this after every edit.',
    pathDescription: 'Path to the topology file (*.topo.json or *.topo)',
  },
  add_device: {
    title: 'Add a device',
    description:
      'Adds a device to a *.topo.json / *.topo file: name (auto-generated from the role ' +
      'when omitted), role/site/device_type, interfaces, and canvas position. The file is ' +
      'rewritten in canonical form and re-validated; fix any reported diagnostics.',
  },
  update_device: {
    title: 'Update a device',
    description:
      'Updates fields of an existing device. new_name renames it and follows every link ' +
      'reference. Set a field to an empty string to remove it; interfaces replaces the ' +
      'whole array ([] removes it). The file is re-validated after the edit.',
  },
  remove_device: {
    title: 'Remove a device',
    description:
      'Removes a device and every link attached to it. Links between surviving nodes are ' +
      'preserved. The file is re-validated after the edit.',
  },
  add_link: {
    title: 'Add a link',
    description:
      'Adds a cable (same-site wiring), circuit (carrier line between sites), or logical ' +
      'link (VRF-to-VRF or to a network segment). Endpoints a/b are objects like ' +
      '{"device":"rt-01","interface":"Gi0/0/0"} — see describe_format for endpoint and ' +
      'attribute fields. Both endpoints must reference existing nodes.',
  },
  remove_link: {
    title: 'Remove a link',
    description:
      'Removes the link of the given kind between two named nodes. When several parallel ' +
      'links match, the error lists candidates — retry with match_index.',
  },
  set_position: {
    title: 'Move a node on the canvas',
    description:
      'Sets the canvas position of a device, provider network, or network segment. ' +
      'Combine with render_svg to check and fix the layout.',
  },
  render_svg: {
    title: 'Render a topology as an SVG image',
    description:
      'Renders a *.topo.json / *.topo file to a standalone SVG string — the same image ' +
      'the editor exports. Use it to SEE the diagram: check layout, overlaps, and ' +
      'placement after editing positions. view "physical" shows cables and carrier ' +
      'circuits; "logical" shows VRF compartments, logical links, and network segments.',
    pathDescription: 'Path to the topology file (*.topo.json or *.topo)',
    viewDescription: "Which editor view to render (default 'physical')",
    showGlobalDescription:
      'Logical view: include the implicit global routing-table compartment row (default true)',
    underlayDescription:
      'Logical view: draw the physical links dimmed underneath (default true)',
    backgroundDescription:
      "'canvas' paints the editor backdrop, 'transparent' omits it (default 'canvas')",
  },
} as const;

/** The format contract for agents (core genSchemaDoc: rules + schema + example). */
export function describeFormat(): string {
  return genSchemaDoc();
}

export interface TopologySummary {
  devices: number;
  provider_networks: number;
  networks: number;
  cables: number;
  circuits: number;
  logical_links: number;
  sites: string[];
  vrfs: string[];
  diagnostics: { errors: number; warnings: number };
}

export interface ReadTopologyResult {
  summary: TopologySummary;
  /** Canonical (serialize-ordered) topology value. */
  topology: Topology;
}

/**
 * Summary + canonical form of one document. Throws TopoParseError for text
 * that does not parse — the server maps that to an isError tool result
 * pointing at validate_topology.
 */
export function readTopologyText(text: string): ReadTopologyResult {
  const t = parse(text);
  const diagnostics = validateText(text);
  return {
    summary: {
      devices: t.devices.length,
      provider_networks: (t.provider_networks ?? []).length,
      networks: (t.networks ?? []).length,
      cables: (t.cables ?? []).length,
      circuits: (t.circuits ?? []).length,
      logical_links: (t.logical_links ?? []).length,
      sites: sitesList(t),
      vrfs: allVrfs(t),
      diagnostics: {
        errors: diagnostics.filter((d) => d.severity === 'error').length,
        warnings: diagnostics.filter((d) => d.severity === 'warning').length,
      },
    },
    topology: toCanonical(t),
  };
}

export interface ValidateTopologyResult {
  ok: boolean;
  diagnostics: CliDiagnostic[];
}

/** Full diagnostics for one document (shared with the CLI and the editor). */
export function validateTopologyText(text: string): ValidateTopologyResult {
  const diagnostics = validateText(text);
  return { ok: diagnostics.every((d) => d.severity !== 'error'), diagnostics };
}

/**
 * SVG render of one document (#13): the core renderer the editor's image
 * export uses — agents get the same picture the human sees. Throws
 * TopoParseError for text that does not parse.
 */
export function renderSvgText(text: string, options: SvgOptions = {}): string {
  return genSvg(parse(text), options);
}

export interface StructuredRender {
  svg: string;
  /** Canonical topology — the widget's structuredContent payload (#30). */
  topology: Topology;
}

/**
 * SVG + canonical topology in one parse (#30): the MCP Apps variant of the
 * render tool sends the topology to the widget via structuredContent while
 * keeping the SVG as the fallback / model-visible content.
 */
export function renderStructured(text: string, options: SvgOptions = {}): StructuredRender {
  const t = parse(text);
  return { svg: genSvg(t, options), topology: toCanonical(t) };
}

/* ---------- edit tools (#12): parse → mutate → deterministic serialize ---------- */

/**
 * Outcome of one structured edit. `text` is the FULL new document (core
 * serialize — deterministic, clean diffs); the server writes it back and
 * reports `applied` + post-edit `diagnostics` (validation-in-the-loop).
 * Hard failures (unknown names, ambiguous matches) throw instead.
 */
export interface EditOutcome {
  applied: string;
  diagnostics: CliDiagnostic[];
  text: string;
}

const finish = (topology: Topology, applied: string): EditOutcome => {
  const out = serialize(topology);
  return { applied, diagnostics: validateText(out), text: out };
};

const nodeNames = (t: Topology): string[] => [
  ...t.devices.map((d) => d.name),
  ...(t.provider_networks ?? []).map((p) => p.name),
  ...(t.networks ?? []).map((n) => n.name),
];

export interface DeviceFields {
  role?: string;
  site?: string;
  device_type?: string;
  /** Full replacement of the interfaces array; [] removes it. */
  interfaces?: Record<string, unknown>[];
}

/** Set provided fields; an empty string removes the field (documented). */
function applyDeviceFields(device: Device, fields: DeviceFields): string[] {
  const changed: string[] = [];
  for (const key of ['role', 'site', 'device_type'] as const) {
    const value = fields[key];
    if (value === undefined) continue;
    if (value === '') delete device[key];
    else device[key] = value;
    changed.push(key);
  }
  if (fields.interfaces !== undefined) {
    if (fields.interfaces.length === 0) delete device.interfaces;
    else device.interfaces = fields.interfaces as unknown as DeviceInterface[];
    changed.push('interfaces');
  }
  return changed;
}

export interface AddDeviceParams extends DeviceFields {
  name?: string;
  x?: number;
  y?: number;
}

export function addDeviceText(text: string, params: AddDeviceParams): EditOutcome {
  let t = parse(text);
  if (params.name !== undefined && nodeNames(t).includes(params.name)) {
    throw new Error(`a node named "${params.name}" already exists`);
  }
  // default placement: right of the current diagram, top row
  const x = params.x ?? Math.max(60, ...t.devices.map((d) => (d.position?.x ?? 0) + 200));
  const y = params.y ?? 60;
  const added = addDevice(t, params.role ?? '', x, y);
  t = added.topology;
  let name = added.name;
  if (params.name !== undefined && params.name !== name) {
    t = renameDevice(t, name, params.name);
    name = params.name;
  }
  const device = findDevice(t, name) as Device;
  applyDeviceFields(device, params);
  return finish(t, `added device "${name}"`);
}

export interface UpdateDeviceParams extends DeviceFields {
  name: string;
  new_name?: string;
}

export function updateDeviceText(text: string, params: UpdateDeviceParams): EditOutcome {
  let t = parse(text);
  if (!findDevice(t, params.name)) {
    throw new Error(`no device named "${params.name}" — devices: ${t.devices.map((d) => d.name).join(', ') || '(none)'}`);
  }
  let name = params.name;
  const changed: string[] = [];
  if (params.new_name !== undefined && params.new_name !== name) {
    if (nodeNames(t).includes(params.new_name)) {
      throw new Error(`a node named "${params.new_name}" already exists`);
    }
    t = renameDevice(t, name, params.new_name);
    name = params.new_name;
    changed.push(`renamed to "${name}" (link references followed)`);
  }
  const device = findDevice(t, name) as Device;
  changed.push(...applyDeviceFields(device, params));
  if (!changed.length) throw new Error('nothing to change — pass new_name or fields to set');
  return finish(t, `updated device "${name}": ${changed.join(', ')}`);
}

export function removeDeviceText(text: string, name: string): EditOutcome {
  const t = parse(text);
  if (!findDevice(t, name)) {
    throw new Error(`no device named "${name}" — devices: ${t.devices.map((d) => d.name).join(', ') || '(none)'}`);
  }
  const linksBefore =
    (t.cables ?? []).length + (t.circuits ?? []).length + (t.logical_links ?? []).length;
  const next = deleteNodes(t, [name]);
  const linksAfter =
    (next.cables ?? []).length + (next.circuits ?? []).length + (next.logical_links ?? []).length;
  return finish(
    next,
    `removed device "${name}" and ${linksBefore - linksAfter} attached link(s)`,
  );
}

export type LinkKind = 'cable' | 'circuit' | 'logical';
const COLLECTION: Record<LinkKind, 'cables' | 'circuits' | 'logical_links'> = {
  cable: 'cables',
  circuit: 'circuits',
  logical: 'logical_links',
};

type Endpoint = Record<string, unknown>;

const endpointNode = (ep: Endpoint): string | undefined =>
  (ep.network ?? ep.provider_network ?? ep.device) as string | undefined;

export interface AddLinkParams {
  kind: LinkKind;
  a: Endpoint;
  b: Endpoint;
  /** Extra top-level link fields (label, type, bandwidth, cid, provider, …). */
  attributes?: Record<string, unknown>;
}

export function addLinkText(text: string, params: AddLinkParams): EditOutcome {
  const t = parse(text);
  const names = new Set(nodeNames(t));
  for (const [side, ep] of [
    ['a', params.a],
    ['b', params.b],
  ] as const) {
    const node = endpointNode(ep);
    if (node === undefined) {
      throw new Error(`endpoint "${side}" needs a device, provider_network, or network name`);
    }
    if (!names.has(node)) {
      throw new Error(
        `endpoint "${side}" references unknown node "${node}" — nodes: ${[...names].join(', ') || '(none)'}`,
      );
    }
  }
  const link = { a: params.a, b: params.b, ...(params.attributes ?? {}) };
  const next =
    params.kind === 'cable'
      ? addCable(t, link as unknown as Cable)
      : params.kind === 'circuit'
        ? addCircuit(t, link as unknown as Circuit)
        : addLogicalLink(t, link as unknown as LogicalLink);
  return finish(
    next,
    `added ${params.kind} link ${endpointNode(params.a)} — ${endpointNode(params.b)}`,
  );
}

export interface RemoveLinkParams {
  kind: LinkKind;
  a_name: string;
  b_name: string;
  /** Disambiguates parallel links (from the candidate list in the error). */
  match_index?: number;
}

export function removeLinkText(text: string, params: RemoveLinkParams): EditOutcome {
  const t = parse(text);
  const collection = COLLECTION[params.kind];
  const links = (t[collection] ?? []) as { a: Endpoint; b: Endpoint }[];
  const wanted = [params.a_name, params.b_name].sort().join('|');
  const candidates = links
    .map((l, index) => ({ l, index }))
    .filter(
      ({ l }) =>
        [endpointNode(l.a) ?? '', endpointNode(l.b) ?? ''].sort().join('|') === wanted,
    );
  if (!candidates.length) {
    throw new Error(`no ${params.kind} link between "${params.a_name}" and "${params.b_name}"`);
  }
  let picked = candidates[0] as { l: unknown; index: number };
  if (candidates.length > 1) {
    const byIndex = candidates.find(({ index }) => index === params.match_index);
    if (!byIndex) {
      throw new Error(
        `${candidates.length} parallel ${params.kind} links match — pass match_index: ` +
          candidates
            .map(({ l, index }) => `${index} (${JSON.stringify(l).slice(0, 80)}…)`)
            .join(', '),
      );
    }
    picked = byIndex;
  }
  return finish(
    deleteLink(t, collection, picked.index),
    `removed ${params.kind} link ${params.a_name} — ${params.b_name} (index ${picked.index})`,
  );
}

export function setPositionText(text: string, name: string, x: number, y: number): EditOutcome {
  const t = parse(text);
  const node =
    findDevice(t, name) ??
    (t.provider_networks ?? []).find((p) => p.name === name) ??
    (t.networks ?? []).find((n) => n.name === name);
  if (!node) {
    throw new Error(`no node named "${name}" — nodes: ${nodeNames(t).join(', ') || '(none)'}`);
  }
  node.position = { x, y };
  return finish(t, `moved "${name}" to (${x}, ${y})`);
}
