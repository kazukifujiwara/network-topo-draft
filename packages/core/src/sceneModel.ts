/**
 * Scene view-model: the pure "what to draw" derivation shared by the
 * webview canvas and the SVG export generator (moved here from
 * webview-ui/scene.ts so both stay pixel-identical by construction).
 *
 * Ported from the frozen v7 `render()` prelude: node boxes (devices,
 * provider networks, multi-access segments), link endpoints/labels, and the
 * scene bounding box. Rendering (DOM in the webview, strings in the
 * generator) stays with each consumer.
 */
import type { Cable, Circuit, LogicalEndpoint, LogicalLink, Topology } from './model';
import { allVrfs, deriveDeviceVrfs, iconKey, siteOf } from './model';
import { NODE_H, NODE_W, nodeHeight, vrfRows } from './geometry';
import { autoLayout, needsAutoLayout } from './operations';
import type { GlyphKey } from './glyphs';

export type ViewMode = 'physical' | 'logical';

/** The view state the scene derivation depends on. */
export interface SceneView {
  viewMode: ViewMode;
  /**
   * Logical view: the VRFs whose compartment rows and logical links are
   * drawn ('' = the global routing table); undefined = no filter (#46).
   * View-only state — never part of the file.
   */
  vrfs?: readonly string[];
}

/** Does the view's VRF filter show this VRF ('' = global)? */
export function vrfVisible(view: SceneView, vrf: string): boolean {
  return !view.vrfs || view.vrfs.includes(vrf);
}

/**
 * Effective VRF filter for a render request: an explicit list, optionally
 * minus the global row (`showGlobal: false` — the pre-#46 toggle, still
 * accepted by the export and the MCP tool). Undefined when nothing is
 * filtered, so unfiltered renders stay byte-identical.
 */
export function vrfFilterOf(
  topology: Topology,
  vrfs: readonly string[] | undefined,
  showGlobal: boolean | undefined,
): readonly string[] | undefined {
  if (showGlobal !== false) return vrfs;
  return (vrfs ?? ['', ...allVrfs(topology)]).filter((v) => v !== '');
}

export interface NodeVM {
  kind: 'device' | 'pn' | 'network';
  name: string;
  x: number;
  y: number;
  h: number;
  sub: string;
  /** third label line (segment VIP) */
  extra?: string;
  icon: GlyphKey;
  site: string;
  /** compartment rows in the logical view ('' = global); [] otherwise */
  rows: string[];
}

export type LinkKind = 'cable' | 'circuit' | 'logical';

/** What a link endpoint references (mirrors NodeVM.kind). */
export type EndpointKind = NodeVM['kind'];

export interface LinkVM {
  kind: LinkKind;
  /** stable reference: 'cables:0' */
  refKey: string;
  aName: string | undefined;
  bName: string | undefined;
  aKind: EndpointKind;
  bKind: EndpointKind;
  aVrf: string;
  bVrf: string;
  aId: string;
  bId: string;
  label: string;
}

/**
 * Positions are required for drawing: files without them get the initial
 * auto-placement (plan §3) — ephemeral only, never written back.
 */
export function displayTopology(topology: Topology): Topology {
  return needsAutoLayout(topology) ? autoLayout(topology) : topology;
}

/** Node view-models by name (first occurrence wins, like reference lookups). */
export function buildNodes(topology: Topology, view: SceneView): Map<string, NodeVM> {
  const map = new Map<string, NodeVM>();
  for (const d of topology.devices) {
    if (map.has(d.name)) continue;
    const rows =
      view.viewMode === 'logical' ? vrfRows(deriveDeviceVrfs(topology, d.name), view.vrfs) : [];
    map.set(d.name, {
      kind: 'device',
      name: d.name,
      x: d.position?.x ?? 0,
      y: d.position?.y ?? 0,
      h: view.viewMode === 'logical' ? nodeHeight(rows.length) : NODE_H,
      sub: [d.role, d.device_type].filter(Boolean).join(' · ') || '—',
      icon: iconKey(d.role),
      site: siteOf(d),
      rows,
    });
  }
  for (const p of topology.provider_networks ?? []) {
    if (map.has(p.name)) continue;
    map.set(p.name, {
      kind: 'pn',
      name: p.name,
      x: p.position?.x ?? 0,
      y: p.position?.y ?? 0,
      h: NODE_H,
      sub: 'provider net' + (p.provider ? ' · ' + p.provider : ''),
      icon: 'pnet',
      site: '',
      rows: [],
    });
  }
  // multi-access segments are an L3 construct — logical view only (spec §3.10)
  if (view.viewMode === 'logical') {
    for (const n of topology.networks ?? []) {
      if (map.has(n.name)) continue;
      // segments carry no VRF of their own: under a VRF filter a segment
      // stays only while one of its attachments is drawn (#46)
      if (view.vrfs && !segmentAttached(topology, n.name, view)) continue;
      const vm: NodeVM = {
        kind: 'network',
        name: n.name,
        x: n.position?.x ?? 0,
        y: n.position?.y ?? 0,
        h: NODE_H,
        sub: [n.prefix, n.vlan ? 'vlan ' + n.vlan : ''].filter(Boolean).join(' · ') || 'segment',
        icon: 'network',
        site: '',
        rows: [],
      };
      if (n.fhrp?.virtual_ip) {
        vm.extra = `VIP ${n.fhrp.virtual_ip}${n.fhrp.protocol ? ' (' + n.fhrp.protocol + (n.fhrp.group_id ? ' ' + n.fhrp.group_id : '') + ')' : ''}`;
      }
      map.set(n.name, vm);
    }
  }
  return map;
}

/** Is some logical link from a visible VRF attached to this segment? */
function segmentAttached(topology: Topology, network: string, view: SceneView): boolean {
  return (topology.logical_links ?? []).some((l) => {
    const a = l.a ?? {};
    const b = l.b ?? {};
    const other = a.network === network ? b : b.network === network ? a : undefined;
    return (
      other !== undefined && other.network === undefined && vrfVisible(view, (other.vrf ?? '').trim())
    );
  });
}

function linkLabel(kind: LinkKind, raw: Cable | Circuit | LogicalLink): string {
  if (kind === 'circuit') {
    const c = raw as Circuit;
    return [c.cid, c.provider, c.commit_rate].filter(Boolean).join(' · ') || 'circuit';
  }
  if (kind === 'logical') {
    const l = raw as LogicalLink;
    // VRF names are already visible on the compartments — show ID/label only
    return [l.link_id, l.label].filter(Boolean).join(' · ');
  }
  const c = raw as Cable;
  return [c.label, c.type, c.bandwidth].filter(Boolean).join(' · ');
}

export function buildLinks(topology: Topology): LinkVM[] {
  const out: LinkVM[] = [];
  const push = (
    kind: LinkKind,
    col: 'cables' | 'circuits' | 'logical_links',
    idx: number,
    raw: Cable | Circuit | LogicalLink,
  ): void => {
    const a = raw.a ?? {};
    const b = raw.b ?? {};
    const endKind = (e: typeof a): EndpointKind =>
      (e as LogicalEndpoint).network !== undefined
        ? 'network'
        : e.provider_network !== undefined
          ? 'pn'
          : 'device';
    out.push({
      kind,
      refKey: `${col}:${idx}`,
      aName: (a as LogicalEndpoint).network ?? a.provider_network ?? a.device,
      bName: (b as LogicalEndpoint).network ?? b.provider_network ?? b.device,
      aKind: endKind(a),
      bKind: endKind(b),
      aVrf: ('vrf' in a ? (a.vrf ?? '') : '').trim(),
      bVrf: ('vrf' in b ? (b.vrf ?? '') : '').trim(),
      aId: ('id' in a ? (a.id ?? '') : '').trim(),
      bId: ('id' in b ? (b.id ?? '') : '').trim(),
      label: linkLabel(kind, raw),
    });
  };
  // v7 held one links[] in cables → circuits → logical order after import
  (topology.cables ?? []).forEach((c, i) => push('cable', 'cables', i, c));
  (topology.circuits ?? []).forEach((c, i) => push('circuit', 'circuits', i, c));
  (topology.logical_links ?? []).forEach((l, i) => push('logical', 'logical_links', i, l));
  return out;
}

/** The VRF that colors a logical link (a-side wins, like v7). */
export const logicalVrfOf = (l: LinkVM): string => l.aVrf || l.bVrf;

/**
 * Is a link drawn in the current view? Shared by the canvas and the SVG
 * export so parallel-offset bundling stays identical. Under a VRF filter a
 * logical link stays while EITHER device end sits in a visible VRF —
 * isolating one VRF keeps its leaks in the picture (#46); segment ends
 * carry no VRF and do not vote.
 */
export function linkDrawn(l: LinkVM, view: SceneView, underlayOn: boolean): boolean {
  if (view.viewMode === 'physical') return l.kind !== 'logical';
  if (l.kind !== 'logical') return underlayOn;
  if (!view.vrfs) return true;
  const ends: [EndpointKind, string][] = [
    [l.aKind, l.aVrf],
    [l.bKind, l.bVrf],
  ];
  return ends.filter(([k]) => k !== 'network').some(([, vrf]) => vrfVisible(view, vrf));
}

/** World-space bounding box of all nodes plus the v7 fit padding (70px). */
export function sceneBounds(
  topology: Topology,
  view: SceneView,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const nodes = buildNodes(displayTopology(topology), view);
  if (!nodes.size) return null;
  const vms = [...nodes.values()];
  return {
    x0: Math.min(...vms.map((n) => n.x)) - 70,
    y0: Math.min(...vms.map((n) => n.y)) - 70,
    x1: Math.max(...vms.map((n) => n.x + NODE_W)) + 70,
    y1: Math.max(...vms.map((n) => n.y + n.h)) + 70,
  };
}
