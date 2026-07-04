/**
 * Canvas rendering, ported from v7 `render()`. Since Phase 2 it also draws
 * the editing affordances: selection outlines, hover ports (node edges in
 * the physical view, VRF compartment ports in the logical view), link hit
 * areas, and compartment drop highlighting during link drags.
 *
 * Geometry and VRF derivation come from @topodraft/core; this module only
 * builds SVG. Dynamic colors go through CSSOM (style.*) so the webview CSP
 * needs no 'unsafe-inline'.
 */
import type { Cable, Circuit, LogicalEndpoint, LogicalLink, Topology } from '@topodraft/core';
import {
  NODE_H,
  NODE_W,
  allVrfs,
  anchor,
  autoLayout,
  deriveDeviceVrfs,
  iconKey,
  linkSegment,
  logAnchor,
  needsAutoLayout,
  nodeHeight,
  siteOf,
  sitesList,
  vrfColor,
  vrfRowIndex,
  vrfRowRect,
  vrfRows,
} from '@topodraft/core';
import { ICONS, ROLE_COLOR } from './icons';
import { T } from './strings';

export type ViewMode = 'physical' | 'logical';

export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

export interface ViewOptions {
  vt: ViewTransform;
  viewMode: ViewMode;
  underlayOn: boolean;
  showGlobal: boolean;
  gridOn: boolean;
}

/** Editing affordances drawn on top of the base scene (Phase 2). */
export interface EditVisuals {
  selectedNodes: ReadonlySet<string>;
  /** linkRefKey ('cables:0') of the selected link, if any. */
  selectedLink: string | null;
  hoverNode: string | null;
  /** '<node>|<vrf>' of the hovered compartment (extra top/bottom ports). */
  hoverRow: string | null;
  /** '<node>|<vrf>' of the compartment highlighted as a drop target. */
  dropRow: string | null;
  /** While dragging a new link every compartment shows its ports. */
  linkDragging: boolean;
}

export interface SceneDom {
  svg: SVGSVGElement;
  world: SVGGElement;
  lyGrid: SVGGElement;
  lySites: SVGGElement;
  lyLinks: SVGGElement;
  lyNodes: SVGGElement;
  lyLogi: SVGGElement;
  emptyHint: HTMLElement;
  viewBadge: HTMLElement;
  vrfLegend: HTMLElement;
  counts: HTMLElement;
  zoomPct: HTMLElement;
}

const SVGNS = 'http://www.w3.org/2000/svg';

function el(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const e = document.createElementNS(SVGNS, tag) as SVGElement;
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

/* ---------- display model ---------- */

export interface NodeVM {
  kind: 'device' | 'pn' | 'network';
  name: string;
  x: number;
  y: number;
  h: number;
  sub: string;
  /** third label line (segment VIP) */
  extra?: string;
  icon: keyof typeof ICONS;
  site: string;
  /** compartment rows in the logical view ('' = global); [] otherwise */
  rows: string[];
}

export type LinkKind = 'cable' | 'circuit' | 'logical';

interface LinkVM {
  kind: LinkKind;
  /** stable DOM reference: 'cables:0' */
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
export function buildNodes(topology: Topology, view: ViewOptions): Map<string, NodeVM> {
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
        vm.extra = `VIP ${n.fhrp.virtual_ip}${n.fhrp.protocol ? ' (' + n.fhrp.protocol + (n.fhrp.group ? ' ' + n.fhrp.group : '') + ')' : ''}`;
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

function buildLinks(topology: Topology): LinkVM[] {
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

const logicalVrfOf = (l: LinkVM): string => l.aVrf || l.bVrf;

/** World-space bounding box of all nodes plus the v7 fit padding (70px). */
export function sceneBounds(
  topology: Topology,
  view: ViewOptions,
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

const NO_EDIT: EditVisuals = {
  selectedNodes: new Set(),
  selectedLink: null,
  hoverNode: null,
  hoverRow: null,
  dropRow: null,
  linkDragging: false,
};

/* ---------- render ---------- */

export function renderScene(
  dom: SceneDom,
  topology: Topology | null,
  view: ViewOptions,
  edit: EditVisuals = NO_EDIT,
): void {
  dom.lyGrid.style.display = view.gridOn ? '' : 'none';
  dom.lySites.textContent = '';
  dom.lyLinks.textContent = '';
  dom.lyNodes.textContent = '';
  dom.lyLogi.textContent = '';
  dom.world.setAttribute('transform', `translate(${view.vt.x},${view.vt.y}) scale(${view.vt.k})`);
  dom.zoomPct.textContent = Math.round(view.vt.k * 100) + '%';

  if (!topology) {
    dom.emptyHint.style.display = 'none';
    dom.viewBadge.style.display = 'none';
    dom.vrfLegend.style.display = 'none';
    dom.counts.textContent = '—';
    return;
  }

  const t = displayTopology(topology);
  const nodes = buildNodes(t, view);
  const links = buildLinks(t);

  /* sites (v7: devices sharing a site are framed together) */
  const groups = new Map<string, NodeVM[]>();
  for (const n of nodes.values()) {
    if (n.kind === 'device' && n.site) {
      if (!groups.has(n.site)) groups.set(n.site, []);
      (groups.get(n.site) as NodeVM[]).push(n);
    }
  }
  for (const [s, ds] of groups) {
    const PAD = 26;
    const x0 = Math.min(...ds.map((d) => d.x)) - PAD;
    const y0 = Math.min(...ds.map((d) => d.y)) - PAD - 12;
    const x1 = Math.max(...ds.map((d) => d.x + NODE_W)) + PAD;
    const y1 = Math.max(...ds.map((d) => d.y + d.h)) + PAD;
    const g = el('g');
    g.appendChild(
      el('rect', { class: 'site-rect', x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 12 }),
    );
    const lbl = el('text', { class: 'site-label', x: x0 + 12, y: y0 + 18, 'data-site': s });
    lbl.textContent = '⌖ ' + s;
    g.appendChild(lbl);
    dom.lySites.appendChild(g);
  }

  /* links — parallel offsets are computed over ALL links like v7 (hidden
     links still consume an offset slot) */
  const pairIdx = new Map<string, number>();
  const pairTotal = new Map<string, number>();
  for (const l of links) {
    const key = [l.aName ?? '', l.bName ?? ''].sort().join('|');
    pairTotal.set(key, (pairTotal.get(key) ?? 0) + 1);
  }
  for (const l of links) {
    const key = [l.aName ?? '', l.bName ?? ''].sort().join('|');
    const i = (pairIdx.get(key) ?? -1) + 1;
    pairIdx.set(key, i);
    if (view.viewMode === 'physical' && l.kind === 'logical') continue;
    const physInLogical = view.viewMode === 'logical' && l.kind !== 'logical';
    if (physInLogical && !view.underlayOn) continue;
    const a = l.aName !== undefined ? nodes.get(l.aName) : undefined;
    const b = l.bName !== undefined ? nodes.get(l.bName) : undefined;
    if (!a || !b) continue; // dangling reference — validate() reports it
    const ac = { x: a.x + NODE_W / 2, y: a.y + a.h / 2 };
    const bc = { x: b.x + NODE_W / 2, y: b.y + b.h / 2 };
    const logicalAnchor = (n: NodeVM, vrf: string, tx: number, ty: number) => {
      if (n.kind === 'pn' || view.viewMode !== 'logical') return null;
      const idx = vrfRowIndex(n.rows, vrf, view.showGlobal);
      if (idx < 0) return null;
      return logAnchor(vrfRowRect(n.x, n.y, idx), tx, ty);
    };
    let p1;
    let p2;
    if (l.kind === 'logical' && view.viewMode === 'logical') {
      p1 = logicalAnchor(a, l.aVrf, bc.x, bc.y) ?? anchor(a.x, a.y, NODE_W, a.h, bc.x, bc.y);
      p2 = logicalAnchor(b, l.bVrf, ac.x, ac.y) ?? anchor(b.x, b.y, NODE_W, b.h, ac.x, ac.y);
    } else {
      p1 = anchor(a.x, a.y, NODE_W, a.h, bc.x, bc.y);
      p2 = anchor(b.x, b.y, NODE_W, b.h, ac.x, ac.y);
    }
    const seg = linkSegment(p1, p2, i, pairTotal.get(key) ?? 1);
    const selected = edit.selectedLink === l.refKey;
    const g = el('g', {
      class: 'link' + (selected ? ' selected' : '') + (physInLogical ? ' dim' : ''),
      'data-link': l.refKey,
    });
    g.appendChild(el('path', { class: 'link-hit', d: seg.d }));
    const line = el('path', {
      class:
        'link-line ' + (l.kind === 'circuit' ? 'circuit' : l.kind === 'logical' ? 'logical' : ''),
      d: seg.d,
    });
    if (l.kind === 'logical' && !selected) {
      (line as SVGElement).style.stroke = vrfColor(logicalVrfOf(l));
    }
    g.appendChild(line);
    const txt = l.label;
    if (txt) {
      const tEl = el('text', { class: 'link-label', x: seg.lx, y: seg.ly, 'text-anchor': 'middle' });
      if (l.kind === 'logical' && !selected) {
        (tEl as SVGElement).style.fill = vrfColor(logicalVrfOf(l));
      }
      tEl.textContent = txt;
      g.appendChild(tEl);
    }
    if (l.kind === 'logical' && view.viewMode === 'logical') {
      /* endpoint dots + endpoint IDs, drawn above the nodes (v7 lyLogi) */
      const ends: [string, { x: number; y: number }, { x: number; y: number }][] = [
        [l.aId, seg.p1, seg.p2],
        [l.bId, seg.p2, seg.p1],
      ];
      const vrfs = [l.aVrf, l.bVrf];
      ends.forEach(([idTxt, pt, other], side) => {
        const dot = el('circle', { cx: pt.x, cy: pt.y, r: 3.2, 'pointer-events': 'none' });
        (dot as SVGElement).style.fill = vrfColor(vrfs[side] ?? '');
        g.appendChild(dot);
        if (idTxt) {
          const f = 0.16;
          const tx = pt.x + (other.x - pt.x) * f;
          const ty = pt.y + (other.y - pt.y) * f - 7;
          const t2 = el('text', { class: 'ep-id', x: tx, y: ty, 'text-anchor': 'middle' });
          t2.textContent = idTxt;
          g.appendChild(t2);
        }
      });
      dom.lyLogi.appendChild(g);
    } else {
      dom.lyLinks.appendChild(g);
    }
  }

  /* nodes */
  const singleSelection = edit.selectedNodes.size === 1;
  for (const n of nodes.values()) {
    const selected = edit.selectedNodes.has(n.name);
    const showPorts = (selected && singleSelection) || edit.hoverNode === n.name;
    const g = el('g', {
      class: 'node' + (selected ? ' selected' : ''),
      'data-node': n.name,
      transform: `translate(${n.x},${n.y})`,
    });
    g.appendChild(
      el('rect', {
        class: 'node-box' + (n.kind === 'pn' ? ' pnbox' : n.kind === 'network' ? ' netbox' : ''),
        width: NODE_W,
        height: n.h,
        rx: n.kind === 'network' ? 24 : 9,
      }),
    );
    const ig = el('g', { transform: 'translate(11,13)' });
    ig.innerHTML = `<g fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" transform="scale(1.08)">${ICONS[n.icon]}</g>`;
    (ig.firstChild as SVGElement).style.stroke = ROLE_COLOR[n.icon];
    g.appendChild(ig);
    const nm = el('text', { class: 'node-name', x: 44, y: 22 });
    nm.textContent = n.name || '(no name)';
    g.appendChild(nm);
    const sub = el('text', { class: 'node-sub', x: 44, y: n.extra ? 33 : 37 });
    sub.textContent = n.sub;
    g.appendChild(sub);
    if (n.extra) {
      const extra = el('text', { class: 'node-vip', x: 44, y: 45 });
      extra.textContent = n.extra;
      g.appendChild(extra);
    }
    if (view.viewMode === 'logical' && n.kind === 'device') {
      n.rows.forEach((v, idx) => {
        const rect = vrfRowRect(0, 0, idx);
        const col = v ? vrfColor(v) : 'var(--line2)';
        const dropping = edit.dropRow === `${n.name}|${v}`;
        const row = el('rect', {
          class: 'vrf-row' + (dropping ? ' drop' : ''),
          x: rect.x,
          y: rect.y,
          width: rect.w,
          height: rect.h,
          rx: 5,
          'stroke-opacity': v ? 0.9 : 0.6,
          'data-vrfrow': n.name,
          'data-vrfname': v,
        });
        (row as SVGElement).style.stroke = col;
        g.appendChild(row);
        const tEl = el('text', { class: 'vrf-row-label', x: 16, y: rect.y + 12 });
        (tEl as SVGElement).style.fill = v ? col : 'var(--tx3)';
        tEl.textContent = v || 'global';
        g.appendChild(tEl);
        if (showPorts || edit.linkDragging) {
          const rcy = rect.y + rect.h / 2;
          const pts: [number, number][] = [
            [rect.x, rcy],
            [rect.x + rect.w, rcy],
          ];
          if (edit.hoverRow === `${n.name}|${v}`) {
            pts.push([NODE_W / 2, rect.y], [NODE_W / 2, rect.y + rect.h]);
          }
          for (const [px, py] of pts) {
            g.appendChild(
              el('circle', {
                class: 'port',
                cx: px,
                cy: py,
                r: 4,
                'data-vrfport': n.name,
                'data-vrfname': v,
              }),
            );
          }
        }
      });
    }
    /* node-edge ports: physical view for all; logical view for PN and for
       devices with no visible compartments (v7) */
    if (
      showPorts &&
      (view.viewMode !== 'logical' || n.kind === 'pn' || n.rows.length === 0)
    ) {
      const edgePts: [number, number][] = [
        [NODE_W / 2, 0],
        [NODE_W, n.h / 2],
        [NODE_W / 2, n.h],
        [0, n.h / 2],
      ];
      for (const [px, py] of edgePts) {
        g.appendChild(el('circle', { class: 'port', cx: px, cy: py, r: 4.5, 'data-port': n.name }));
      }
    }
    dom.lyNodes.appendChild(g);
  }

  /* overlays & status (v7 render tail) */
  dom.emptyHint.style.display = nodes.size ? 'none' : 'block';
  dom.viewBadge.style.display = view.viewMode === 'logical' ? 'block' : 'none';
  const vrfs = allVrfs(t);
  if (view.viewMode === 'logical' && vrfs.length) {
    dom.vrfLegend.style.display = 'flex';
    dom.vrfLegend.textContent = '';
    const title = document.createElement('div');
    title.className = 'vt';
    title.textContent = 'VRF';
    dom.vrfLegend.appendChild(title);
    for (const v of vrfs) {
      const chip = document.createElement('div');
      chip.className = 'vrf-chip';
      const dot = document.createElement('span');
      dot.className = 'vrf-dot';
      dot.style.background = vrfColor(v);
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(v));
      dom.vrfLegend.appendChild(chip);
    }
  } else {
    dom.vrfLegend.style.display = 'none';
  }
  const nDev = t.devices.length;
  const nPn = (t.provider_networks ?? []).length;
  const nNet = (t.networks ?? []).length;
  const nc = (t.cables ?? []).length;
  const ni = (t.circuits ?? []).length;
  const nl = (t.logical_links ?? []).length;
  dom.counts.textContent =
    `${nDev} ${T('st_devices')}${nPn ? ` · ${nPn} ${T('st_pn')}` : ''}${nNet ? ` · ${nNet} ${T('st_networks')}` : ''} · ${nc + ni + nl} ${T('st_links')} (${nc} cable / ${ni} circuit / ${nl} logical) · ${sitesList(t).length} ${T('st_sites')}` +
    (edit.selectedNodes.size > 1 ? ` · ${edit.selectedNodes.size} ${T('st_sel')}` : '');
}
