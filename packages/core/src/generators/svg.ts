/**
 * SVG image export (#9): renders a topology to a standalone SVG string
 * using the same geometry and view-model code as the canvas (../sceneModel,
 * ../geometry), so the exported image matches the editor by construction —
 * minus the editing affordances, the background grid, and the HTML
 * overlays (VRF legend, view badge, status counts), which are editor
 * chrome rather than diagram content.
 *
 * Pure string building — no DOM. Presentation is inlined as attributes
 * (no <style> element) so the file renders identically in strict SVG
 * consumers. Colors are the editor's dark palette (webview styles.css);
 * the backdrop can be omitted for transparent embedding.
 */
import type { Topology } from '../model';
import {
  NODE_W,
  SEGMENT_RX,
  anchor,
  linkSegment,
  logAnchor,
  roundedAnchor,
  vrfColor,
  vrfRowIndex,
  vrfRowRect,
} from '../geometry';
import type { LinkVM, NodeVM, SceneView, ViewMode } from '../sceneModel';
import { buildLinks, buildNodes, displayTopology, logicalVrfOf, sceneBounds } from '../sceneModel';
import type { GlyphKey } from '../glyphs';
import { GLYPHS } from '../glyphs';

export interface SvgOptions {
  /** Which editor view to render (default 'physical'). */
  view?: ViewMode;
  /** Logical view: show the implicit global ('' VRF) row (default true). */
  showGlobal?: boolean;
  /** Logical view: draw the dimmed physical underlay (default true). */
  underlay?: boolean;
  /** 'canvas' paints the editor backdrop; 'transparent' omits it (default 'canvas'). */
  background?: 'canvas' | 'transparent';
}

/* Editor dark palette (webview styles.css :root). */
const BG0 = '#0f1317';
const BG2 = '#1d242c';
const LINE2 = '#3a4552';
const TX = '#dee5ee';
const TX3 = '#5e6b7d';
const PN_STROKE = '#5a5344';
const NET_STROKE = '#6fb3e0'; /* --c-network */
const NET_FILL = '#17222c';
const CIRCUIT = '#b18cff'; /* --c-cloud */
const SITE_FILL = '#6aa9ff'; /* at 0.025 opacity */

const ROLE_HEX: Record<GlyphKey, string> = {
  router: '#5b9dff',
  switch: '#4cc38a',
  firewall: '#f2994a',
  cloud: '#b18cff',
  server: '#45c4ce',
  generic: '#93a0b4',
  pnet: '#d9a44c',
  network: '#6fb3e0',
};

const MONO =
  "ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, 'Roboto Mono', monospace";

/** Deterministic coordinate formatting: ≤2 decimals, no trailing zeros. */
const fmt = (n: number): string => String(Math.round(n * 100) / 100);

function xmlEscape(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function genSvg(topology: Topology, options: SvgOptions = {}): string {
  const view: SceneView = {
    viewMode: options.view ?? 'physical',
    showGlobal: options.showGlobal ?? true,
  };
  const underlayOn = options.underlay ?? true;
  const t = displayTopology(topology);
  const nodes = buildNodes(t, view);
  const links = buildLinks(t);
  const b = sceneBounds(topology, view) ?? { x0: 0, y0: 0, x1: 300, y1: 150 };
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(b.x0)} ${fmt(b.y0)} ${fmt(w)} ${fmt(h)}" width="${fmt(w)}" height="${fmt(h)}" font-family="${xmlEscape(MONO)}">`,
  );
  if ((options.background ?? 'canvas') === 'canvas') {
    out.push(
      `<rect x="${fmt(b.x0)}" y="${fmt(b.y0)}" width="${fmt(w)}" height="${fmt(h)}" fill="${BG0}"/>`,
    );
  }

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
    out.push(
      `<rect x="${fmt(x0)}" y="${fmt(y0)}" width="${fmt(x1 - x0)}" height="${fmt(y1 - y0)}" rx="12" fill="${SITE_FILL}" fill-opacity="0.025" stroke="${LINE2}" stroke-width="1.2" stroke-dasharray="7 5"/>`,
    );
    out.push(
      `<text x="${fmt(x0 + 12)}" y="${fmt(y0 + 18)}" fill="${TX3}" font-size="11" letter-spacing="0.08em">${xmlEscape('⌖ ' + s)}</text>`,
    );
  }

  /* links — same bundling as the canvas: parallel offsets are computed over
     all links drawn in the current view; logical links bundle by (node, vrf)
     pair so endpoints stay on their compartment rows */
  const physLayer: string[] = [];
  const logiLayer: string[] = [];
  const drawnInView = (l: LinkVM): boolean => {
    if (view.viewMode === 'physical' && l.kind === 'logical') return false;
    if (view.viewMode === 'logical' && l.kind !== 'logical' && !underlayOn) return false;
    return true;
  };
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
  const pairIdx = new Map<string, number>();
  for (const l of links) {
    if (!drawnInView(l)) continue;
    const key = pairKey(l);
    const i = (pairIdx.get(key) ?? -1) + 1;
    pairIdx.set(key, i);
    const physInLogical = view.viewMode === 'logical' && l.kind !== 'logical';
    const a = l.aName !== undefined ? nodes.get(l.aName) : undefined;
    const b2 = l.bName !== undefined ? nodes.get(l.bName) : undefined;
    if (!a || !b2) continue; // dangling reference — validate() reports it
    const ac = { x: a.x + NODE_W / 2, y: a.y + a.h / 2 };
    const bc = { x: b2.x + NODE_W / 2, y: b2.y + b2.h / 2 };
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
      p2 = logicalAnchor(b2, l.bVrf, ac.x, ac.y) ?? bodyAnchor(b2, ac.x, ac.y);
    } else {
      p1 = bodyAnchor(a, bc.x, bc.y);
      p2 = bodyAnchor(b2, ac.x, ac.y);
    }
    const seg = linkSegment(p1, p2, i, pairTotal.get(key) ?? 1);
    const d = `M ${fmt(seg.p1.x)} ${fmt(seg.p1.y)} L ${fmt(seg.p2.x)} ${fmt(seg.p2.y)}`;
    const g: string[] = [];
    g.push(`<g${physInLogical ? ' opacity="0.15"' : ''}>`);
    if (l.kind === 'circuit') {
      g.push(
        `<path d="${d}" fill="none" stroke="${CIRCUIT}" stroke-width="1.8" stroke-dasharray="8 5"/>`,
      );
    } else if (l.kind === 'logical') {
      g.push(
        `<path d="${d}" fill="none" stroke="${vrfColor(logicalVrfOf(l))}" stroke-width="2.2" stroke-dasharray="1.5 6" stroke-linecap="round"/>`,
      );
    } else {
      g.push(`<path d="${d}" fill="none" stroke="${TX3}" stroke-width="1.6"/>`);
    }
    if (l.label) {
      const fill = l.kind === 'logical' ? vrfColor(logicalVrfOf(l)) : TX3;
      g.push(
        `<text x="${fmt(seg.lx)}" y="${fmt(seg.ly)}" text-anchor="middle" fill="${fill}" font-size="10">${xmlEscape(l.label)}</text>`,
      );
    }
    if (l.kind === 'logical' && view.viewMode === 'logical') {
      /* endpoint dots + endpoint IDs, drawn above the nodes (v7 lyLogi) */
      const ends: [string, { x: number; y: number }, { x: number; y: number }][] = [
        [l.aId, seg.p1, seg.p2],
        [l.bId, seg.p2, seg.p1],
      ];
      const vrfs = [l.aVrf, l.bVrf];
      ends.forEach(([idTxt, pt, other], side) => {
        g.push(
          `<circle cx="${fmt(pt.x)}" cy="${fmt(pt.y)}" r="3.2" fill="${vrfColor(vrfs[side] ?? '')}"/>`,
        );
        if (idTxt) {
          const f = 0.16;
          const tx = pt.x + (other.x - pt.x) * f;
          const ty = pt.y + (other.y - pt.y) * f - 7;
          g.push(
            `<text x="${fmt(tx)}" y="${fmt(ty)}" text-anchor="middle" fill="${TX3}" font-size="9">${xmlEscape(idTxt)}</text>`,
          );
        }
      });
    }
    g.push('</g>');
    (l.kind === 'logical' && view.viewMode === 'logical' ? logiLayer : physLayer).push(
      g.join(''),
    );
  }
  out.push(...physLayer);

  /* nodes */
  for (const n of nodes.values()) {
    const g: string[] = [];
    g.push(`<g transform="translate(${fmt(n.x)},${fmt(n.y)})">`);
    const box =
      n.kind === 'pn'
        ? ` stroke="${PN_STROKE}" stroke-dasharray="6 4" fill="${BG2}"`
        : n.kind === 'network'
          ? ` stroke="${NET_STROKE}" fill="${NET_FILL}"`
          : ` stroke="${LINE2}" fill="${BG2}"`;
    g.push(
      `<rect width="${fmt(NODE_W)}" height="${fmt(n.h)}" rx="${n.kind === 'network' ? SEGMENT_RX : 9}" stroke-width="1.2"${box}/>`,
    );
    g.push(
      `<g transform="translate(11,13)"><g fill="none" stroke="${ROLE_HEX[n.icon]}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" transform="scale(1.08)">${GLYPHS[n.icon]}</g></g>`,
    );
    g.push(
      `<text x="44" y="22" fill="${TX}" font-size="12" font-weight="600">${xmlEscape(n.name || '(no name)')}</text>`,
    );
    g.push(
      `<text x="44" y="${n.extra ? 33 : 37}" fill="${TX3}" font-size="10">${xmlEscape(n.sub)}</text>`,
    );
    if (n.extra) {
      g.push(
        `<text x="44" y="45" fill="${NET_STROKE}" font-size="9">${xmlEscape(n.extra)}</text>`,
      );
    }
    if (view.viewMode === 'logical' && n.kind === 'device') {
      n.rows.forEach((v, idx) => {
        const rect = vrfRowRect(0, 0, idx);
        const col = v ? vrfColor(v) : LINE2;
        g.push(
          `<rect x="${fmt(rect.x)}" y="${fmt(rect.y)}" width="${fmt(rect.w)}" height="${fmt(rect.h)}" rx="5" fill="${BG0}" stroke="${col}" stroke-width="1" stroke-opacity="${v ? '0.9' : '0.6'}"/>`,
        );
        g.push(
          `<text x="16" y="${fmt(rect.y + 12)}" fill="${v ? col : TX3}" font-size="10">${xmlEscape(v || 'global')}</text>`,
        );
      });
    }
    g.push('</g>');
    out.push(g.join(''));
  }

  out.push(...logiLayer);
  out.push('</svg>');
  return out.join('\n');
}
