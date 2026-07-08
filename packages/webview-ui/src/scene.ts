/**
 * Canvas rendering, ported from v7 `render()`. Since Phase 2 it also draws
 * the editing affordances: selection outlines, hover ports (node edges in
 * the physical view, VRF compartment ports in the logical view), link hit
 * areas, and compartment drop highlighting during link drags.
 *
 * The scene view-model (what to draw) lives in @topodraft/core/sceneModel,
 * shared with the SVG export generator so both stay pixel-identical; this
 * module only builds the DOM. Dynamic colors go through CSSOM (style.*) so
 * the webview CSP needs no 'unsafe-inline'.
 */
import type { LinkVM, NodeVM, Topology, ViewMode } from '@topodraft/core';
import {
  NODE_W,
  SEGMENT_RX,
  allVrfs,
  anchor,
  buildLinks,
  buildNodes,
  displayTopology,
  linkSegment,
  logAnchor,
  logicalVrfOf,
  roundedAnchor,
  sceneBounds,
  sitesList,
  vrfColor,
  vrfRowIndex,
  vrfRowRect,
} from '@topodraft/core';
import { ICONS, ROLE_COLOR } from './icons';
import { T } from './strings';

export type { NodeVM, ViewMode };
export { buildNodes, displayTopology, sceneBounds };

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
  const drawnInView = (l: LinkVM): boolean => {
    if (view.viewMode === 'physical' && l.kind === 'logical') return false;
    if (view.viewMode === 'logical' && l.kind !== 'logical' && !view.underlayOn) return false;
    return true;
  };
  // Parallel-offset bundles: two links spread apart only when their ANCHORS
  // coincide. In the logical view each VRF pair anchors to its own
  // compartment rows, so bundling by node pair (v7) shifted endpoints off
  // their rows once a device pair carried several VRFs — bundle logical
  // links by (node, vrf) pair instead, and never mix them with the physical
  // underlay. Only links drawn in the current view join a bundle.
  const pairKey = (l: LinkVM): string =>
    l.kind === 'logical' && view.viewMode === 'logical'
      ? 'logi:' + [`${l.aName ?? ''}#${l.aVrf}`, `${l.bName ?? ''}#${l.bVrf}`].sort().join('|')
      : 'phys:' + [l.aName ?? '', l.bName ?? ''].sort().join('|');
  const pairTotal = new Map<string, number>();
  for (const l of links) {
    if (!drawnInView(l)) continue;
    const key = pairKey(l);
    pairTotal.set(key, (pairTotal.get(key) ?? 0) + 1);
  }
  for (const l of links) {
    if (!drawnInView(l)) continue;
    const key = pairKey(l);
    const i = (pairIdx.get(key) ?? -1) + 1;
    pairIdx.set(key, i);
    const physInLogical = view.viewMode === 'logical' && l.kind !== 'logical';
    const a = l.aName !== undefined ? nodes.get(l.aName) : undefined;
    const b = l.bName !== undefined ? nodes.get(l.bName) : undefined;
    if (!a || !b) continue; // dangling reference — validate() reports it
    const ac = { x: a.x + NODE_W / 2, y: a.y + a.h / 2 };
    const bc = { x: b.x + NODE_W / 2, y: b.y + b.h / 2 };
    // segment nodes are pills — anchor on the rounded boundary, not the rect
    const bodyAnchor = (n: NodeVM, tx: number, ty: number) =>
      n.kind === 'network'
        ? roundedAnchor(n.x, n.y, NODE_W, n.h, SEGMENT_RX, tx, ty)
        : anchor(n.x, n.y, NODE_W, n.h, tx, ty);
    const logicalAnchor = (n: NodeVM, vrf: string, tx: number, ty: number) => {
      if (n.kind !== 'device' || view.viewMode !== 'logical') return null;
      const idx = vrfRowIndex(n.rows, vrf, view.showGlobal);
      if (idx < 0) return null;
      return logAnchor(vrfRowRect(n.x, n.y, idx), tx, ty);
    };
    let p1;
    let p2;
    if (l.kind === 'logical' && view.viewMode === 'logical') {
      p1 = logicalAnchor(a, l.aVrf, bc.x, bc.y) ?? bodyAnchor(a, bc.x, bc.y);
      p2 = logicalAnchor(b, l.bVrf, ac.x, ac.y) ?? bodyAnchor(b, ac.x, ac.y);
    } else {
      p1 = bodyAnchor(a, bc.x, bc.y);
      p2 = bodyAnchor(b, ac.x, ac.y);
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
        rx: n.kind === 'network' ? SEGMENT_RX : 9,
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
