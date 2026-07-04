import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import {
  convertCableToCircuit,
  convertCircuitToCable,
  makeClipboard,
  pasteClipboard,
} from '../src/operations';

const base = () =>
  parse(
    JSON.stringify({
      version: 1,
      devices: [
        { name: 'rt-1', site: 'HQ', vrfs: ['PROD'], position: { x: 100, y: 100 } },
        { name: 'rt-2', site: 'DC', position: { x: 300, y: 100 } },
        { name: 'outsider', position: { x: 500, y: 500 } },
      ],
      provider_networks: [{ name: 'DX', provider: 'AWS', position: { x: 200, y: 300 } }],
      cables: [{ a: { device: 'rt-1' }, b: { device: 'rt-2' }, type: 'smf' }],
      circuits: [
        { a: { device: 'rt-1' }, b: { provider_network: 'DX' }, cid: 'C-1', status: 'active' },
        { a: { device: 'rt-2' }, b: { device: 'outsider' } },
      ],
      logical_links: [{ a: { device: 'rt-1', vrf: 'PROD' }, b: { device: 'rt-2' }, vlan: '100' }],
    }),
  );

describe('makeClipboard (v7 copySel)', () => {
  it('copies the selected nodes and only the links BETWEEN them', () => {
    const clip = makeClipboard(base(), ['rt-1', 'rt-2', 'DX']);
    expect(clip.devices.map((d) => d.name)).toEqual(['rt-1', 'rt-2']);
    expect(clip.provider_networks.map((p) => p.name)).toEqual(['DX']);
    expect(clip.cables).toHaveLength(1);
    expect(clip.circuits).toHaveLength(1); // rt-2↔outsider excluded
    expect(clip.logical_links).toHaveLength(1);
  });

  it('is a deep copy that survives edits to the source', () => {
    const t = base();
    const clip = makeClipboard(t, ['rt-1']);
    (t.devices[0] as { name: string }).name = 'mutated';
    expect(clip.devices[0]?.name).toBe('rt-1');
  });
});

describe('pasteClipboard (v7 pasteClip)', () => {
  it('pastes with fresh unique names, remapped internal references, and shifted positions', () => {
    const t = base();
    const clip = makeClipboard(t, ['rt-1', 'rt-2', 'DX']);
    const { topology, renames } = pasteClipboard(t, clip, 1000, 1000);
    expect(renames.get('rt-1')).toBe('rt-1-2');
    expect(renames.get('DX')).toBe('DX-2');
    // clipboard top-left (rt-1 @100,100) lands at (1000,1000); offsets kept
    const pasted1 = topology.devices.find((d) => d.name === 'rt-1-2');
    const pasted2 = topology.devices.find((d) => d.name === 'rt-2-2');
    expect(pasted1?.position).toEqual({ x: 1000, y: 1000 });
    expect(pasted2?.position).toEqual({ x: 1200, y: 1000 });
    // pasted links reference the NEW names; originals untouched
    expect(topology.cables).toHaveLength(2);
    expect(topology.cables?.[1]?.a.device).toBe('rt-1-2');
    expect(topology.cables?.[0]?.a.device).toBe('rt-1');
    expect(topology.circuits?.[2]?.b.provider_network).toBe('DX-2');
    expect(topology.logical_links?.[1]?.a).toEqual({ device: 'rt-1-2', vrf: 'PROD' });
  });

  it('pasting twice keeps generating unique names', () => {
    const t = base();
    const clip = makeClipboard(t, ['rt-1']);
    const once = pasteClipboard(t, clip, 0, 0).topology;
    const twice = pasteClipboard(once, clip, 50, 50).topology;
    const names = twice.devices.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('rt-1-2');
    expect(names).toContain('rt-1-3');
  });

  it('does not mutate the input topology or the clipboard', () => {
    const t = base();
    const clip = makeClipboard(t, ['rt-1']);
    const tSnap = JSON.stringify(t);
    const clipSnap = JSON.stringify(clip);
    pasteClipboard(t, clip, 0, 0);
    expect(JSON.stringify(t)).toBe(tSnap);
    expect(JSON.stringify(clip)).toBe(clipSnap);
  });

  it('an empty clipboard is a no-op', () => {
    const { topology, renames } = pasteClipboard(base(), makeClipboard(base(), []), 0, 0);
    expect(topology).toEqual(base());
    expect(renames.size).toBe(0);
  });
});

describe('cable ⇄ circuit conversion (v7 context menu)', () => {
  it('cable → circuit keeps a/b/type/status and drops cable-only fields', () => {
    const t = parse(
      JSON.stringify({
        version: 1,
        devices: [{ name: 'a', site: 'S1' }, { name: 'b', site: 'S2' }],
        cables: [
          { a: { device: 'a' }, b: { device: 'b' }, type: 'smf', status: 'connected', bandwidth: '10G', label: 'x' },
        ],
      }),
    );
    const out = convertCableToCircuit(t, 0);
    expect(out.cables).toBeUndefined();
    expect(out.circuits).toEqual([
      { a: { device: 'a' }, b: { device: 'b' }, type: 'smf', status: 'connected' },
    ]);
  });

  it('circuit → cable strips site (derived) and circuit-only fields', () => {
    const t = base();
    const out = convertCircuitToCable(t, 0); // rt-1 ↔ DX, cid C-1
    expect(out.circuits).toHaveLength(1);
    expect(out.cables).toHaveLength(2);
    expect(out.cables?.[1]).toEqual({
      a: { device: 'rt-1' },
      b: { provider_network: 'DX' },
      status: 'active',
    });
  });

  it('out-of-range indexes are no-ops', () => {
    expect(convertCableToCircuit(base(), 5)).toEqual(base());
    expect(convertCircuitToCable(base(), -1)).toEqual(base());
  });
});
