import { describe, expect, it } from 'vitest';
import {
  GRID,
  HEAD_H,
  NODE_H,
  NODE_W,
  SEGMENT_RX,
  VRF_PAL,
  VRF_ROW,
  anchor,
  roundedAnchor,
  linkSegment,
  logAnchor,
  nodeHeight,
  snap,
  vrfColor,
  vrfRowIndex,
  vrfRowRect,
  vrfRows,
} from '../src/geometry';

describe('snap', () => {
  it('rounds to the 10px grid when on', () => {
    expect(snap(14)).toBe(10);
    expect(snap(15)).toBe(20);
    expect(snap(-14)).toBe(-10);
  });
  it('passes through when off', () => {
    expect(snap(14, false)).toBe(14);
  });
  it('GRID is the v7 constant', () => {
    expect(GRID).toBe(10);
  });
});

describe('nodeHeight (v7 nodeH)', () => {
  it('is NODE_H for physical view / provider networks', () => {
    expect(nodeHeight()).toBe(NODE_H);
    expect(NODE_H).toBe(52);
    expect(NODE_W).toBe(152);
  });
  it('grows by VRF_ROW per compartment row in the logical view', () => {
    expect(nodeHeight(0)).toBe(HEAD_H + 6);
    expect(nodeHeight(3)).toBe(HEAD_H + 3 * VRF_ROW + 6);
  });
});

describe('anchor (edge of box toward target, v7 anchor)', () => {
  it('returns the center when the target IS the center', () => {
    expect(anchor(0, 0, 100, 50, 50, 25)).toEqual({ x: 50, y: 25 });
  });
  it('hits the right edge for a target straight right', () => {
    expect(anchor(0, 0, 100, 50, 300, 25)).toEqual({ x: 100, y: 25 });
  });
  it('hits the top edge for a target straight above', () => {
    expect(anchor(0, 0, 100, 50, 50, -100)).toEqual({ x: 50, y: 0 });
  });
  it('clips diagonal rays to the nearer edge', () => {
    // 45° ray from center of a wide box exits through top/bottom first
    const p = anchor(0, 0, 100, 50, 150, 125);
    expect(p).toEqual({ x: 75, y: 50 });
  });
});

describe('roundedAnchor (pill-shaped segment nodes)', () => {
  const [X, Y, W, H, R] = [0, 0, NODE_W, NODE_H, SEGMENT_RX];
  const boundary = (p: { x: number; y: number }): number => {
    const ex = Math.max(Math.abs(p.x - (X + W / 2)) - (W / 2 - R), 0);
    const ey = Math.max(Math.abs(p.y - (Y + H / 2)) - (H / 2 - R), 0);
    return ex * ex + ey * ey;
  };

  it('matches the rect anchor on straight edges', () => {
    expect(roundedAnchor(X, Y, W, H, R, 1000, H / 2)).toEqual(anchor(X, Y, W, H, 1000, H / 2));
    expect(roundedAnchor(X, Y, W, H, R, W / 2, -500)).toEqual(anchor(X, Y, W, H, W / 2, -500));
  });

  it('lands ON the rounded boundary for diagonal rays (rect anchor floats outside)', () => {
    const target = { x: 276, y: -24 }; // exits through the top-right corner arc
    const p = roundedAnchor(X, Y, W, H, R, target.x, target.y);
    expect(boundary(p)).toBeCloseTo(R * R, 5);
    const rect = anchor(X, Y, W, H, target.x, target.y);
    expect(boundary(rect)).toBeGreaterThan(R * R + 50); // the bug this fixes
  });

  it('degenerates to the rect anchor with r=0 and to the center for a zero ray', () => {
    expect(roundedAnchor(X, Y, W, H, 0, 300, 300)).toEqual(anchor(X, Y, W, H, 300, 300));
    expect(roundedAnchor(X, Y, W, H, R, W / 2, H / 2)).toEqual({ x: W / 2, y: H / 2 });
  });
});

describe('VRF compartments', () => {
  it('vrfRows prepends the global row when shown (v7 vrfRows)', () => {
    expect(vrfRows(['A', 'B'], true)).toEqual(['', 'A', 'B']);
    expect(vrfRows(['A', 'B'], false)).toEqual(['A', 'B']);
  });

  it('vrfRowIndex resolves global/VRF/hidden rows (v7 vrfRowIdx)', () => {
    const rows = vrfRows(['A', 'B'], true);
    expect(vrfRowIndex(rows, '', true)).toBe(0);
    expect(vrfRowIndex(rows, undefined, true)).toBe(0);
    expect(vrfRowIndex(rows, 'B', true)).toBe(2);
    expect(vrfRowIndex(rows, 'ghost', true)).toBe(0); // unknown VRF falls back to global
    const noGlobal = vrfRows(['A'], false);
    expect(vrfRowIndex(noGlobal, '', false)).toBe(-1); // hidden
    expect(vrfRowIndex(noGlobal, 'A', false)).toBe(0);
  });

  it('vrfRowRect matches the v7 compartment metrics', () => {
    expect(vrfRowRect(100, 200, 0)).toEqual({ x: 108, y: 200 + HEAD_H + 2, w: NODE_W - 16, h: VRF_ROW - 4 });
    expect(vrfRowRect(100, 200, 2).y).toBe(200 + HEAD_H + 2 * VRF_ROW + 2);
  });

  it('logAnchor picks the compartment side facing the target (v7 logAnchor)', () => {
    const r = { x: 0, y: 0, w: 100, h: 20 };
    expect(logAnchor(r, 500, 10)).toEqual({ x: 100, y: 10 }); // right
    expect(logAnchor(r, -500, 10)).toEqual({ x: 0, y: 10 }); // left
    expect(logAnchor(r, 50, 500)).toEqual({ x: 50, y: 20 }); // bottom
    expect(logAnchor(r, 50, -500)).toEqual({ x: 50, y: 0 }); // top
    expect(logAnchor(r, 500, null)).toEqual({ x: 100, y: 10 }); // no ty → horizontal
  });
});

describe('linkSegment (straight lines with parallel offsets, v7 linkPath)', () => {
  it('a single link connects the anchors directly, label lifted 6px above the midpoint', () => {
    const s = linkSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, 0, 1);
    expect(s.p1).toEqual({ x: 0, y: 0 });
    expect(s.p2).toEqual({ x: 100, y: 0 });
    expect(s.d).toBe('M 0 0 L 100 0');
    expect(s.lx).toBe(50);
    expect(s.ly).toBe(-6);
  });

  it('parallel links are offset perpendicular, 16px apart and centered', () => {
    const a = linkSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, 0, 2);
    const b = linkSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, 1, 2);
    expect(a.p1.y).toBe(-8); // off = (0 - 0.5) * 16 along the (0, dx/len) normal
    expect(b.p1.y).toBe(8);
    expect(a.p1.x).toBe(0); // offset is purely perpendicular
    expect(Math.abs(a.p1.y - b.p1.y)).toBe(16);
  });

  it('the middle of an odd bundle stays on the direct line', () => {
    const mid = linkSegment({ x: 0, y: 0 }, { x: 0, y: 100 }, 1, 3);
    expect(mid.p1).toEqual({ x: 0, y: 0 });
    expect(mid.p2).toEqual({ x: 0, y: 100 });
  });
});

describe('vrfColor (v7 hash)', () => {
  it('is deterministic and palette-bound', () => {
    expect(vrfColor('PROD')).toBe(vrfColor('PROD'));
    expect(VRF_PAL).toContain(vrfColor('PROD'));
    expect(VRF_PAL).toContain(vrfColor('anything'));
  });
  it('global (empty) gets the fixed neutral gray', () => {
    expect(vrfColor('')).toBe('#8FA0B8');
  });
  it('matches the v7 hash for a known value', () => {
    // h('PROD') = ((((80*31+82)*31+79)*31+68) >>> 0) — index 7 in the 8-color palette
    expect(vrfColor('PROD')).toBe('#7BD88F');
  });
});
