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
import { deriveDeviceVrfs, iconKey, siteOf } from './model';
import { NODE_H, NODE_W, nodeHeight, vrfRows } from './geometry';
import { autoLayout, needsAutoLayout } from './operations';
import type { GlyphKey } from './glyphs';

export type ViewMode = 'physical' | 'logical';

/** The two view flags the scene derivation depends on. */
export interface SceneView {
  viewMode: ViewMode;
  /** Show the implicit global ('' VRF) compartment row in the logical view. */
  showGlobal: boolean;
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

export interface LinkVM {
  kind: LinkKind;
  /** stable reference: 'cables:0' */
  refKey: string;
  aName: string | undefined;
  bName: string | undefined;
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
      view.viewMode === 'logical'
        ? vrfRows(deriveDeviceVrfs(topology, d.name), view.showGlobal)
        : [];
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
    out.push({
      kind,
      refKey: `${col}:${idx}`,
      aName: (a as LogicalEndpoint).network ?? a.provider_network ?? a.device,
      bName: (b as LogicalEndpoint).network ?? b.provider_network ?? b.device,
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
