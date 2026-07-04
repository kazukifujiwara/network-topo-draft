/**
 * Read-only canvas rendering, ported from v7 `render()` minus everything
 * edit-related (selection, ports, drag ghosts, guides). Geometry and VRF
 * derivation come from @topodraft/core; this module only builds SVG.
 */
import type { Cable, Circuit, LogicalLink, Topology } from '@topodraft/core';
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

interface NodeVM {
  kind: 'device' | 'pn';
  name: string;
  x: number;
  y: number;
  h: number;
  sub: string;
  icon: keyof typeof ICONS;
  site: string;
  /** compartment rows in the logical view ('' = global); [] otherwise */
  rows: string[];
}

type LinkKind = 'cable' | 'circuit' | 'logical';

interface LinkVM {
  kind: LinkKind;
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
 * auto-placement (plan §3) — ephemeral only, never written back in Phase 1.
 */
export function displayTopology(topology: Topology): Topology {
  return needsAutoLayout(topology) ? autoLayout(topology) : topology;
}

function buildNodes(topology: Topology, view: ViewOptions): Map<string, NodeVM> {
  const map = new Map<string, NodeVM>();
  for (const d of topology.devices) {
    if (map.has(d.name)) continue; // references resolve to the first occurrence
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
  const push = (kind: LinkKind, raw: Cable | Circuit | LogicalLink): void => {
    const a = raw.a ?? {};
    const b = raw.b ?? {};
    out.push({
      kind,
      aName: a.provider_network ?? a.device,
      bName: b.provider_network ?? b.device,
      aVrf: ('vrf' in a ? (a.vrf ?? '') : '').trim(),
      bVrf: ('vrf' in b ? (b.vrf ?? '') : '').trim(),
      aId: ('id' in a ? (a.id ?? '') : '').trim(),
      bId: ('id' in b ? (b.id ?? '') : '').trim(),
      label: linkLabel(kind, raw),
    });
  };
  // v7 held one links[] in cables → circuits → logical order after import
  for (const c of topology.cables ?? []) push('cable', c);
  for (const c of topology.circuits ?? []) push('circuit', c);
  for (const l of topology.logical_links ?? []) push('logical', l);
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

/* ---------- render ---------- */

export function renderScene(dom: SceneDom, topology: Topology | null, view: ViewOptions): void {
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
    const lbl = el('text', { class: 'site-label', x: x0 + 12, y: y0 + 18 });
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
    const g = el('g', { class: 'link' + (physInLogical ? ' dim' : '') });
    const line = el('path', {
      class: 'link-line ' + (l.kind === 'circuit' ? 'circuit' : l.kind === 'logical' ? 'logical' : ''),
      d: seg.d,
    });
    if (l.kind === 'logical') (line as SVGElement).style.stroke = vrfColor(logicalVrfOf(l));
    g.appendChild(line);
    const txt = l.label;
    if (txt) {
      const tEl = el('text', { class: 'link-label', x: seg.lx, y: seg.ly, 'text-anchor': 'middle' });
      if (l.kind === 'logical') (tEl as SVGElement).style.fill = vrfColor(logicalVrfOf(l));
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
  for (const n of nodes.values()) {
    const g = el('g', { class: 'node', 'data-node': n.name, transform: `translate(${n.x},${n.y})` });
    g.appendChild(
      el('rect', { class: 'node-box' + (n.kind === 'pn' ? ' pnbox' : ''), width: NODE_W, height: n.h, rx: 9 }),
    );
    const ig = el('g', { transform: 'translate(11,13)' });
    ig.innerHTML = `<g fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" transform="scale(1.08)">${ICONS[n.icon]}</g>`;
    (ig.firstChild as SVGElement).style.stroke = ROLE_COLOR[n.icon];
    g.appendChild(ig);
    const nm = el('text', { class: 'node-name', x: 44, y: 22 });
    nm.textContent = n.name || '(no name)';
    g.appendChild(nm);
    const sub = el('text', { class: 'node-sub', x: 44, y: 37 });
    sub.textContent = n.sub;
    g.appendChild(sub);
    if (view.viewMode === 'logical' && n.kind === 'device') {
      n.rows.forEach((v, idx) => {
        const rect = vrfRowRect(0, 0, idx);
        const col = v ? vrfColor(v) : 'var(--line2)';
        const row = el('rect', {
          class: 'vrf-row',
          x: rect.x,
          y: rect.y,
          width: rect.w,
          height: rect.h,
          rx: 5,
          'stroke-opacity': v ? 0.9 : 0.6,
        });
        (row as SVGElement).style.stroke = col;
        g.appendChild(row);
        const tEl = el('text', { class: 'vrf-row-label', x: 16, y: rect.y + 12 });
        (tEl as SVGElement).style.fill = v ? col : 'var(--tx3)';
        tEl.textContent = v || 'global';
        g.appendChild(tEl);
      });
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
  const nc = (t.cables ?? []).length;
  const ni = (t.circuits ?? []).length;
  const nl = (t.logical_links ?? []).length;
  dom.counts.textContent =
    `${nDev} devices${nPn ? ` · ${nPn} provider nets` : ''} · ${nc + ni + nl} links (${nc} cable / ${ni} circuit / ${nl} logical) · ${sitesList(t).length} sites`;
}
