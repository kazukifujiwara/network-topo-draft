/**
 * genSvg output is asserted against committed golden files under
 * fixtures/expected/render/ — one per representative fixture × view, so the
 * exported image is locked byte-for-byte (determinism gate). The goldens
 * were produced by genSvg itself and hand-verified against the canvas.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { genSvg } from '../src/generators/svg';
import { readFixture } from './helpers';

const load = (p: string) => parse(readFixture(p));

describe('genSvg goldens', () => {
  it('matches the physical view of the site-cloud fixture', () => {
    expect(genSvg(load('v6v7/site-cloud.topo.json'))).toBe(
      readFixture('expected/render/site-cloud.physical.svg'),
    );
  });

  it('matches the logical view of the site-cloud fixture', () => {
    expect(genSvg(load('v6v7/site-cloud.topo.json'), { view: 'logical' })).toBe(
      readFixture('expected/render/site-cloud.logical.svg'),
    );
  });

  it('matches the logical view of the wan-logical fixture (VRF compartments)', () => {
    expect(genSvg(load('v3/wan-logical.topo.json'), { view: 'logical' })).toBe(
      readFixture('expected/render/wan-logical.logical.svg'),
    );
  });

  it('matches the logical view of the vrrp-segment fixture (segment pill + VIP)', () => {
    expect(genSvg(load('v1/vrrp-segment.topo.json'), { view: 'logical' })).toBe(
      readFixture('expected/render/vrrp-segment.logical.svg'),
    );
  });
});

describe('genSvg behavior', () => {
  it('is deterministic (same input → same bytes)', () => {
    const t = () => load('v6v7/site-cloud.topo.json');
    expect(genSvg(t(), { view: 'logical' })).toBe(genSvg(t(), { view: 'logical' }));
  });

  it('escapes XML special characters in names and labels', () => {
    const out = genSvg(
      parse(
        JSON.stringify({
          version: 1,
          devices: [{ name: 'a<b>&"c', role: 'router' }],
        }),
      ),
    );
    expect(out).toContain('a&lt;b&gt;&amp;&quot;c');
    expect(out).not.toContain('a<b>');
  });

  it('renders an empty topology to a valid minimal SVG', () => {
    const out = genSvg(parse('{"version":1,"devices":[]}'));
    expect(out.startsWith('<svg ')).toBe(true);
    expect(out.endsWith('</svg>')).toBe(true);
    expect(out).not.toContain('NaN');
    expect(out).not.toContain('undefined');
  });

  it('skips links with dangling references instead of emitting broken paths', () => {
    const out = genSvg(
      parse(
        JSON.stringify({
          version: 1,
          devices: [{ name: 'a', position: { x: 0, y: 0 } }],
          cables: [{ a: { device: 'a' }, b: { device: 'ghost' } }],
        }),
      ),
    );
    expect(out).not.toContain('NaN');
    expect(out).not.toContain('d="M '); // no link segment emitted
  });

  it('hides logical links in the physical view and physical links in the logical view when underlay is off', () => {
    const topo = JSON.stringify({
      version: 1,
      devices: [
        { name: 'a', position: { x: 0, y: 0 } },
        { name: 'b', position: { x: 400, y: 0 } },
      ],
      cables: [{ a: { device: 'a' }, b: { device: 'b' } }],
      logical_links: [{ a: { device: 'a', vrf: 'V1' }, b: { device: 'b', vrf: 'V1' } }],
    });
    const physical = genSvg(parse(topo));
    expect(physical).not.toContain('stroke-dasharray="1.5 6"'); // logical link style
    expect(physical).toContain('stroke="#5e6b7d"'); // cable stroke drawn
    const logicalNoUnderlay = genSvg(parse(topo), { view: 'logical', underlay: false });
    expect(logicalNoUnderlay).toContain('stroke-dasharray="1.5 6"');
    expect(logicalNoUnderlay).not.toContain('opacity="0.15"'); // no dimmed underlay
    const logicalWithUnderlay = genSvg(parse(topo), { view: 'logical' });
    expect(logicalWithUnderlay).toContain('opacity="0.15"');
  });

  it('omits the backdrop rect for transparent background', () => {
    const t = () => load('v6v7/site-cloud.topo.json');
    const solid = genSvg(t());
    const transparent = genSvg(t(), { background: 'transparent' });
    expect(solid).toContain('fill="#0f1317"');
    expect(transparent).not.toContain('fill="#0f1317"');
  });

  it('the exported view-model matches the canvas by sharing sceneModel (site frame present)', () => {
    const out = genSvg(load('v6v7/two-site-wan.topo.json'));
    expect(out).toContain('⌖ Tokyo-HQ');
    expect(out).toContain('⌖ Osaka-DC');
  });
});
