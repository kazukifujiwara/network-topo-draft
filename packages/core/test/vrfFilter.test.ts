/**
 * Logical-view VRF filter (#46): the scene derivation narrows compartment
 * rows, logical links, and segments to the selected VRFs; unfiltered
 * renders stay byte-identical to the pre-filter goldens.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { buildLinks, buildNodes, linkDrawn, sceneBounds, vrfFilterOf } from '../src/sceneModel';
import type { SceneView } from '../src/sceneModel';
import { genSvg } from '../src/generators/svg';
import { nodeHeight } from '../src/geometry';
import { readFixture } from './helpers';

const topo = () => parse(readFixture('v1/vrf-lite.topo.json'));
const ALL: SceneView = { viewMode: 'logical' };
const BLUE: SceneView = { viewMode: 'logical', vrfs: ['blue'] };
const BLUE_GLOBAL: SceneView = { viewMode: 'logical', vrfs: ['', 'blue'] };

describe('buildNodes under a VRF filter', () => {
  it('narrows the compartment rows and shrinks the box', () => {
    const all = buildNodes(topo(), ALL).get('rt-a');
    const blue = buildNodes(topo(), BLUE).get('rt-a');
    expect(all?.rows).toEqual(['', 'blue', 'red']);
    expect(blue?.rows).toEqual(['blue']);
    expect(blue?.h).toBe(nodeHeight(1));
    expect(all?.h).toBe(nodeHeight(3));
  });

  it('keeps the global row first when it is selected', () => {
    expect(buildNodes(topo(), BLUE_GLOBAL).get('rt-a')?.rows).toEqual(['', 'blue']);
    expect(buildNodes(topo(), { viewMode: 'logical', vrfs: ['blue', ''] }).get('rt-a')?.rows).toEqual([
      '',
      'blue',
    ]);
  });

  it('a device with no selected VRF keeps an empty box (never disappears)', () => {
    const sw = buildNodes(topo(), BLUE).get('sw-a');
    expect(sw?.rows).toEqual([]);
    expect(sw?.h).toBe(nodeHeight(0));
  });

  it('segments stay only while one attachment is drawn', () => {
    expect(buildNodes(topo(), ALL).has('seg-blue')).toBe(true);
    expect(buildNodes(topo(), BLUE).has('seg-blue')).toBe(true); // attached via blue
    expect(buildNodes(topo(), { viewMode: 'logical', vrfs: ['red'] }).has('seg-blue')).toBe(false);
    expect(buildNodes(topo(), { viewMode: 'logical', vrfs: [''] }).has('seg-blue')).toBe(false);
  });

  it('the scene bounds follow the hidden segment and the shorter boxes', () => {
    const all = sceneBounds(topo(), ALL);
    const red = sceneBounds(topo(), { viewMode: 'logical', vrfs: ['red'] });
    expect(red?.y1).toBeLessThan(all?.y1 as number); // seg-blue (y 340) gone
  });

  it('the physical view ignores the filter entirely', () => {
    const phys = buildNodes(topo(), { viewMode: 'physical', vrfs: [] });
    expect(phys.get('rt-a')?.rows).toEqual([]);
    expect(phys.has('seg-blue')).toBe(false); // segments are logical-view only anyway
  });
});

describe('linkDrawn (shared by canvas and SVG export)', () => {
  const byId = (view: SceneView, underlay = true): string[] =>
    buildLinks(topo())
      .filter((l) => linkDrawn(l, view, underlay))
      .map((l) => l.label || `${l.aName}-${l.bName}`);

  it('no filter: the view/underlay rules are unchanged', () => {
    expect(byId({ viewMode: 'physical' })).toEqual(['802.1Q trunk · fiber', 'cat6']);
    expect(byId(ALL)).toHaveLength(8); // 2 physical (underlay) + 6 logical
    expect(byId(ALL, false)).toHaveLength(6);
  });

  it('a logical link stays while EITHER device end is in a visible VRF (leaks stay visible)', () => {
    const blue = byId(BLUE, false);
    expect(blue).toContain('blue-wan');
    expect(blue).toContain('route leak'); // blue ⇄ red leak kept when blue is isolated
    expect(blue).not.toContain('red-wan');
    expect(blue).not.toContain('global-wan');
    expect(byId({ viewMode: 'logical', vrfs: ['red'] }, false)).toEqual(['red-wan', 'route leak']);
  });

  it('segment attachments follow their device end; the segment end does not vote', () => {
    expect(byId(BLUE, false).filter((x) => x.includes('seg-blue'))).toHaveLength(2);
    expect(byId({ viewMode: 'logical', vrfs: [''] }, false)).toEqual(['global-wan']);
  });

  it('the physical underlay is never filtered by VRF', () => {
    expect(byId({ viewMode: 'logical', vrfs: [] })).toEqual(['802.1Q trunk · fiber', 'cat6']);
  });
});

describe('vrfFilterOf (showGlobal compatibility)', () => {
  it('passes an explicit list through and leaves "no filter" alone', () => {
    expect(vrfFilterOf(topo(), undefined, undefined)).toBeUndefined();
    expect(vrfFilterOf(topo(), undefined, true)).toBeUndefined();
    expect(vrfFilterOf(topo(), ['blue'], true)).toEqual(['blue']);
  });

  it('showGlobal:false becomes "every named VRF" or strips the global row from the list', () => {
    expect(vrfFilterOf(topo(), undefined, false)).toEqual(['blue', 'red']);
    expect(vrfFilterOf(topo(), ['', 'red'], false)).toEqual(['red']);
  });
});

describe('genSvg with a VRF filter', () => {
  it('unfiltered output is byte-identical to the committed golden', () => {
    expect(genSvg(topo(), { view: 'logical' })).toBe(
      readFixture('expected/render/vrf-lite.logical.svg'),
    );
  });

  it('the blue-only render matches its golden (rows, leak link, segment kept)', () => {
    const out = genSvg(topo(), { view: 'logical', vrfs: ['blue'] });
    expect(out).toBe(readFixture('expected/render/vrf-lite.logical.blue.svg'));
    expect(out).not.toContain('>red<');
    expect(out).not.toContain('>global<');
    expect(out).toContain('route leak');
    expect(out).toContain('seg-blue');
  });

  it('showGlobal:false equals filtering to the named VRFs', () => {
    expect(genSvg(topo(), { view: 'logical', showGlobal: false })).toBe(
      genSvg(topo(), { view: 'logical', vrfs: ['blue', 'red'] }),
    );
  });

  it('the hidden end of a leak link anchors on the node body, not the global row', () => {
    // rt-b's red row is filtered out: the leak link must not snap to rt-b's
    // global row either (that row is hidden too) — it lands on the box edge
    const blueOnly = genSvg(topo(), { view: 'logical', vrfs: ['blue'] });
    const withGlobal = genSvg(topo(), { view: 'logical', vrfs: ['', 'blue'] });
    expect(blueOnly).not.toBe(withGlobal);
    expect(withGlobal).toContain('>global<');
  });
});
