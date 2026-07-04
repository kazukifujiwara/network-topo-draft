import { describe, expect, it } from 'vitest';
import { parse } from '@topodraft/core';
import { displayTopology, sceneBounds } from '../src/scene';
import { createApp } from '../src/app';
import { fakeHost, mount, readFixture, update } from './helpers';

describe('displayTopology (initial auto-placement, plan §3)', () => {
  it('assigns ephemeral positions when the file has none — the model is untouched', () => {
    const t = parse('{"version":1,"devices":[{"name":"a"},{"name":"b","site":"S"}]}');
    const shown = displayTopology(t);
    expect(shown.devices.every((d) => d.position !== undefined)).toBe(true);
    expect(t.devices.every((d) => d.position === undefined)).toBe(true); // never written back
  });

  it('passes positioned topologies through unchanged', () => {
    const t = parse(readFixture('v1/canonical.topo.json'));
    expect(displayTopology(t)).toBe(t);
  });
});

describe('sceneBounds', () => {
  it('wraps all nodes with the v7 70px padding', () => {
    const t = parse(readFixture('v1/canonical.topo.json'));
    const b = sceneBounds(t, {
      vt: { x: 0, y: 0, k: 1 },
      viewMode: 'physical',
      underlayOn: true,
      showGlobal: true,
      gridOn: true,
    });
    // positions: x 120..820 (+NODE_W 152), y 60..210 (+NODE_H 52)
    expect(b).toEqual({ x0: 50, y0: -10, x1: 1042, y1: 332 });
  });

  it('returns null for an empty topology', () => {
    const t = parse('{"version":1,"devices":[]}');
    expect(
      sceneBounds(t, {
        vt: { x: 0, y: 0, k: 1 },
        viewMode: 'physical',
        underlayOn: true,
        showGlobal: true,
        gridOn: true,
      }),
    ).toBeNull();
  });
});

describe('rendering details', () => {
  it('draws nodes with auto-layout when positions are missing', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(update('{"version":1,"devices":[{"name":"a"},{"name":"b"}]}'));
    const nodes = [...root.querySelectorAll('[data-node]')];
    expect(nodes).toHaveLength(2);
    for (const n of nodes) expect(n.getAttribute('transform')).toMatch(/^translate\(\d+/);
  });

  it('skips links with dangling references instead of crashing (they surface via diagnostics)', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(
      update(
        JSON.stringify({
          version: 1,
          devices: [{ name: 'a', position: { x: 0, y: 0 } }],
          cables: [{ a: { device: 'a' }, b: { device: 'ghost' } }],
        }),
      ),
    );
    expect(root.querySelectorAll('[data-node]')).toHaveLength(1);
    expect(root.querySelectorAll('#lyLinks .link')).toHaveLength(0);
  });

  it('frames devices sharing a site and labels the frame', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(update(readFixture('v6v7/two-site-wan.topo.json')));
    const labels = [...root.querySelectorAll('.site-label')].map((l) => l.textContent);
    expect(labels).toEqual(['⌖ Tokyo-HQ', '⌖ Osaka-DC']);
  });

  it('offsets parallel links between the same pair of nodes', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(
      update(
        JSON.stringify({
          version: 1,
          devices: [
            { name: 'a', position: { x: 0, y: 0 } },
            { name: 'b', position: { x: 400, y: 0 } },
          ],
          cables: [
            { a: { device: 'a' }, b: { device: 'b' } },
            { a: { device: 'a' }, b: { device: 'b' } },
          ],
        }),
      ),
    );
    const [d1, d2] = [...root.querySelectorAll('#lyLinks .link-line')].map((p) =>
      p.getAttribute('d'),
    );
    expect(d1).not.toBe(d2);
  });

  it('renders duplicate names once (references resolve to the first occurrence)', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(
      update(
        JSON.stringify({
          version: 1,
          devices: [
            { name: 'x', position: { x: 0, y: 0 } },
            { name: 'x', position: { x: 300, y: 0 } },
          ],
        }),
      ),
    );
    expect(root.querySelectorAll('[data-node]')).toHaveLength(1);
  });
});
