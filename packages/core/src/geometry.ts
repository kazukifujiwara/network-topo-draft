/**
 * Canvas geometry, ported verbatim from the frozen v7 reference: node
 * dimensions, grid snapping, edge anchors, VRF compartment rects and
 * anchors, and the perpendicular offset applied to parallel links.
 *
 * All functions are pure and operate on explicit coordinates — the view
 * state that v7 kept in globals (viewMode, showGlobal) is passed in by the
 * caller (webview-ui in Phase 1+).
 */

export const NODE_W = 152;
export const NODE_H = 52;
export const GRID = 10;
/** Logical-view compartment metrics. */
export const HEAD_H = 44;
export const VRF_ROW = 24;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Snap a coordinate to the 10px grid (v7 `snap`). */
export function snap(v: number, on = true): number {
  return on ? Math.round(v / GRID) * GRID : v;
}

/**
 * Height of a node box. `vrfRowCount` is the number of visible compartment
 * rows in the logical view (global row included when shown); pass undefined
 * for the physical view or provider networks (v7 `nodeH`).
 */
export function nodeHeight(vrfRowCount?: number): number {
  if (vrfRowCount === undefined) return NODE_H;
  return HEAD_H + vrfRowCount * VRF_ROW + 6;
}

/**
 * Compartment row labels for a device: the derived VRFs, prefixed with the
 * global row ('') when it is shown (v7 `vrfRows`).
 */
export function vrfRows(derivedVrfs: string[], showGlobal: boolean): string[] {
  return showGlobal ? ['', ...derivedVrfs] : derivedVrfs;
}

/** Corner radius of network-segment pill nodes (drawn with rx=SEGMENT_RX). */
export const SEGMENT_RX = 24;

/**
 * Point where the ray from the center of a ROUNDED rectangle toward (tx, ty)
 * crosses its boundary. Plain `anchor()` assumes square corners, which
 * leaves link endpoints floating up to ~r px outside pill-shaped nodes when
 * the ray exits through a rounded corner.
 */
export function roundedAnchor(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  tx: number,
  ty: number,
): Point {
  const cx = x + w / 2;
  const cy = y + h / 2;
  let dx = tx - cx;
  let dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const len = Math.hypot(dx, dy);
  dx /= len;
  dy /= len;
  const radius = Math.min(r, w / 2, h / 2);
  const ix = w / 2 - radius; // straight-edge half extents
  const iy = h / 2 - radius;
  // exits through a straight edge?
  const candidates: number[] = [];
  if (dx !== 0) {
    const t = w / 2 / Math.abs(dx);
    if (Math.abs(dy) * t <= iy + 1e-9) candidates.push(t);
  }
  if (dy !== 0) {
    const t = h / 2 / Math.abs(dy);
    if (Math.abs(dx) * t <= ix + 1e-9) candidates.push(t);
  }
  let t = candidates.length ? Math.min(...candidates) : Infinity;
  if (t === Infinity) {
    // exits through the corner arc in the ray's quadrant:
    // |t·d − q| = radius with q = (±ix, ±iy)
    const qx = (dx >= 0 ? 1 : -1) * ix;
    const qy = (dy >= 0 ? 1 : -1) * iy;
    const b = dx * qx + dy * qy;
    const disc = b * b - (qx * qx + qy * qy - radius * radius);
    t = disc >= 0 ? b + Math.sqrt(disc) : 0;
  }
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * Point where the ray from the box center toward (tx, ty) crosses the box
 * edge (v7 `anchor`).
 */
export function anchor(x: number, y: number, w: number, h: number, tx: number, ty: number): Point {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = w / 2 / Math.max(Math.abs(dx), 1e-9);
  const sy = h / 2 / Math.max(Math.abs(dy), 1e-9);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/**
 * Index of the compartment row for a VRF ('' = global) given the visible
 * rows; -1 when the row is hidden (v7 `vrfRowIdx`).
 */
export function vrfRowIndex(rows: string[], vrf: string | undefined, showGlobal: boolean): number {
  const v = (vrf ?? '').trim();
  if (!v) return showGlobal ? 0 : -1;
  const i = rows.indexOf(v);
  return i < 0 ? (showGlobal ? 0 : -1) : i;
}

/** Rect of the compartment row at `rowIndex` inside a node at (nodeX, nodeY) (v7 `vrfRowRect`). */
export function vrfRowRect(nodeX: number, nodeY: number, rowIndex: number): Rect {
  return {
    x: nodeX + 8,
    y: nodeY + HEAD_H + rowIndex * VRF_ROW + 2,
    w: NODE_W - 16,
    h: VRF_ROW - 4,
  };
}

/**
 * Anchor for a logical endpoint on one of the 4 sides of its compartment,
 * chosen by the direction to the target (v7 `logAnchor`, minus the fallback
 * to the node body, which the caller handles when the row is hidden).
 */
export function logAnchor(row: Rect, tx: number, ty: number | null): Point {
  const cx = row.x + row.w / 2;
  const cy = row.y + row.h / 2;
  const dx = tx - cx;
  const dy = (ty == null ? cy : ty) - cy;
  if (Math.abs(dy) > Math.abs(dx)) return { x: cx, y: dy > 0 ? row.y + row.h : row.y };
  return { x: dx > 0 ? row.x + row.w : row.x, y: cy };
}

export interface LinkSegment {
  /** SVG path data for the straight segment. */
  d: string;
  /** Label position (midpoint, lifted 6px). */
  lx: number;
  ly: number;
  p1: Point;
  p2: Point;
}

/**
 * Straight segment between two anchor points; parallel links between the
 * same node pair are offset perpendicular to the segment, 16px apart and
 * centered (v7 `linkPath` tail). `index` is this link's position among the
 * `total` links of the pair.
 */
export function linkSegment(p1: Point, p2: Point, index: number, total: number): LinkSegment {
  const off = (index - (total - 1) / 2) * 16;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * off;
  const ny = (dx / len) * off;
  const q1 = { x: p1.x + nx, y: p1.y + ny };
  const q2 = { x: p2.x + nx, y: p2.y + ny };
  return {
    d: `M ${q1.x} ${q1.y} L ${q2.x} ${q2.y}`,
    lx: (q1.x + q2.x) / 2,
    ly: (q1.y + q2.y) / 2 - 6,
    p1: q1,
    p2: q2,
  };
}

/* ---------- VRF colors (v7 `vrfColor`; also used by the draw.io generator) ---------- */

export const VRF_PAL = [
  '#6AA9FF',
  '#4CC38A',
  '#F2994A',
  '#B18CFF',
  '#45C4CE',
  '#E5636C',
  '#D9C24C',
  '#7BD88F',
] as const;

/** Deterministic color for a VRF name; '' (global) gets a neutral gray. */
export function vrfColor(vrf: string): string {
  if (!vrf) return '#8FA0B8';
  let h = 0;
  for (const c of vrf) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return VRF_PAL[h % VRF_PAL.length] as string;
}
