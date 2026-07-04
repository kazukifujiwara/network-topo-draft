import { describe, expect, it } from 'vitest';
import { TopoParseError, parse } from '../src/parse';
import type { Topology } from '../src/model';

const j = (v: unknown): string => JSON.stringify(v);

describe('parse — basics', () => {
  it('rejects invalid JSON', () => {
    expect(() => parse('{ nope')).toThrow(TopoParseError);
  });

  it('rejects a non-object top level', () => {
    expect(() => parse('[]')).toThrow(TopoParseError);
    expect(() => parse('"hi"')).toThrow(TopoParseError);
  });

  it('rejects a document without a devices array (v7 importData)', () => {
    expect(() => parse('{}')).toThrow(/no "devices" array/);
    expect(() => parse(j({ devices: 'x' }))).toThrow(/no "devices" array/);
  });

  it('accepts an empty devices array', () => {
    expect(parse(j({ devices: [] })).devices).toEqual([]);
  });

  it('rejects an unsupported version instead of mangling a future format', () => {
    expect(() => parse(j({ version: 2, devices: [] }))).toThrow(/unsupported version/);
    expect(() => parse(j({ version: '1', devices: [] }))).toThrow(/unsupported version/);
  });

  it('preserves version absence (legacy) and presence (v1) on the model', () => {
    expect(parse(j({ devices: [] })).version).toBeUndefined();
    expect(parse(j({ version: 1, devices: [] })).version).toBe(1);
  });

  it('passes $schema through verbatim and never invents one (O3)', () => {
    const url = 'https://example.com/topodraft.schema.json';
    expect(parse(j({ $schema: url, version: 1, devices: [] })).$schema).toBe(url);
    expect(parse(j({ version: 1, devices: [] })).$schema).toBeUndefined();
  });
});

describe('parse — devices', () => {
  it('assigns fallback names node-N / pnet-N (v7 importData)', () => {
    const t = parse(
      j({ devices: [{ role: 'router' }, { name: '' }], provider_networks: [{ provider: 'AWS' }] }),
    );
    expect(t.devices.map((d) => d.name)).toEqual(['node-1', 'node-2']);
    expect(t.provider_networks?.[0]?.name).toBe('pnet-1');
  });

  it('drops empty strings, empty arrays, and fully-empty interfaces', () => {
    const t = parse(
      j({
        devices: [
          {
            name: 'a',
            role: '',
            site: '',
            vrfs: [],
            interfaces: [{ name: '', ip_address: '', type: '' }, { name: 'Gi0' }],
          },
        ],
      }),
    );
    const d = t.devices[0] as NonNullable<Topology['devices'][0]>;
    expect(d).toEqual({ name: 'a', interfaces: [{ name: 'Gi0' }] });
  });

  it('trims and de-empties vrfs entries', () => {
    const t = parse(j({ devices: [{ name: 'a', vrfs: [' PROD ', '', '  '] }] }));
    expect(t.devices[0]?.vrfs).toEqual(['PROD']);
  });

  it('keeps config_context verbatim only when it is a non-empty object', () => {
    const cc = { bgp: { asn: 1 }, empty: '', zero: 0 };
    const t = parse(
      j({
        devices: [
          { name: 'a', config_context: cc },
          { name: 'b', config_context: {} },
          { name: 'c', config_context: [1] },
          { name: 'd', config_context: 'x' },
        ],
      }),
    );
    // contents preserved verbatim — empty values inside are NOT pruned (spec §3.3)
    expect(t.devices[0]?.config_context).toEqual(cc);
    expect(t.devices[1]?.config_context).toBeUndefined();
    expect(t.devices[2]?.config_context).toBeUndefined();
    expect(t.devices[3]?.config_context).toBeUndefined();
  });

  it('keeps position only when both coordinates are finite numbers, rounding them', () => {
    const t = parse(
      j({
        devices: [
          { name: 'a', position: { x: 10.6, y: -3.2 } },
          { name: 'b', position: { x: 'x', y: 0 } },
          { name: 'c', position: { x: 1 } },
          { name: 'd' },
        ],
      }),
    );
    expect(t.devices[0]?.position).toEqual({ x: 11, y: -3 });
    expect(t.devices[1]?.position).toBeUndefined();
    expect(t.devices[2]?.position).toBeUndefined();
    expect(t.devices[3]?.position).toBeUndefined();
  });

  it('drops unknown fields (schema layer reports them)', () => {
    const t = parse(j({ devices: [{ name: 'a', bogus: 1 }], extra: true }));
    expect(t).toEqual({ devices: [{ name: 'a' }] });
  });
});

describe('parse — legacy absorption (spec §7)', () => {
  it('expands a v3 top-level vrf onto both logical endpoints', () => {
    const t = parse(
      j({
        devices: [{ name: 'a' }, { name: 'b' }],
        logical_links: [{ vrf: 'PROD', a: { device: 'a' }, b: { device: 'b' } }],
      }),
    );
    const l = t.logical_links?.[0];
    expect(l?.a).toEqual({ device: 'a', vrf: 'PROD' });
    expect(l?.b).toEqual({ device: 'b', vrf: 'PROD' });
    expect((l as Record<string, unknown> | undefined)?.vrf).toBeUndefined();
  });

  it('an explicit endpoint vrf wins over the v3 top-level vrf', () => {
    const t = parse(
      j({
        devices: [{ name: 'a' }, { name: 'b' }],
        logical_links: [{ vrf: 'OLD', a: { device: 'a', vrf: 'NEW' }, b: { device: 'b' } }],
      }),
    );
    expect(t.logical_links?.[0]?.a.vrf).toBe('NEW');
    expect(t.logical_links?.[0]?.b.vrf).toBe('OLD');
  });

  it('writes an endpoint interface+ip_address through to the device interface (created if missing)', () => {
    const t = parse(
      j({
        devices: [{ name: 'a' }],
        logical_links: [
          { a: { device: 'a', vrf: 'PROD', interface: 'Gi0.100', ip_address: '10.0.0.1/30' }, b: {} },
        ],
      }),
    );
    expect(t.devices[0]?.interfaces).toEqual([
      { name: 'Gi0.100', ip_address: '10.0.0.1/30', vrf: 'PROD' },
    ]);
    expect(t.logical_links?.[0]?.a).toEqual({
      device: 'a',
      vrf: 'PROD',
      interface: 'Gi0.100',
    });
  });

  it('does not overwrite an existing interface IP or VRF (spec §7: "if no existing value")', () => {
    const t = parse(
      j({
        devices: [
          { name: 'a', interfaces: [{ name: 'Gi0.100', ip_address: '10.9.9.9/30', vrf: 'KEEP' }] },
        ],
        logical_links: [
          { a: { device: 'a', vrf: 'PROD', interface: 'Gi0.100', ip_address: '10.0.0.1/30' }, b: {} },
        ],
      }),
    );
    expect(t.devices[0]?.interfaces).toEqual([
      { name: 'Gi0.100', ip_address: '10.9.9.9/30', vrf: 'KEEP' },
    ]);
    expect(t.logical_links?.[0]?.a.ip_address).toBeUndefined();
  });

  it('keeps ip_address on the endpoint when no interface is named (spec §3.8-B)', () => {
    const t = parse(
      j({
        devices: [{ name: 'a' }],
        logical_links: [{ a: { device: 'a', ip_address: '10.0.0.1/30' }, b: {} }],
      }),
    );
    expect(t.logical_links?.[0]?.a).toEqual({ device: 'a', ip_address: '10.0.0.1/30' });
    expect(t.devices[0]?.interfaces).toBeUndefined();
  });
});

describe('parse — reference handling (differs from v7 by design, ADR D10/D11)', () => {
  it('PRESERVES links with dangling device references (v7 dropped them)', () => {
    const t = parse(
      j({
        devices: [{ name: 'a' }],
        cables: [{ a: { device: 'a' }, b: { device: 'ghost' } }],
        circuits: [{ a: { device: 'ghost' }, b: { provider_network: 'nope' } }],
        logical_links: [{ a: { device: 'ghost', vrf: 'X' }, b: { device: 'a' } }],
      }),
    );
    expect(t.cables).toHaveLength(1);
    expect(t.circuits).toHaveLength(1);
    expect(t.logical_links).toHaveLength(1);
    expect(t.cables?.[0]?.b.device).toBe('ghost');
  });

  it('keeps interface+ip_address together on an endpoint whose device is dangling (no data loss)', () => {
    const t = parse(
      j({
        devices: [],
        logical_links: [
          { a: { device: 'ghost', interface: 'Gi0', ip_address: '10.0.0.1/30' }, b: {} },
        ],
      }),
    );
    expect(t.logical_links?.[0]?.a).toEqual({
      device: 'ghost',
      interface: 'Gi0',
      ip_address: '10.0.0.1/30',
    });
  });

  it('keeps the stored site of a circuit endpoint (re-derived by serialize when resolvable)', () => {
    const t = parse(
      j({
        devices: [],
        circuits: [{ a: { site: 'HQ', device: 'ghost' }, b: {} }],
      }),
    );
    expect(t.circuits?.[0]?.a).toEqual({ site: 'HQ', device: 'ghost' });
  });

  it('drops site on cable endpoints (cables never carry site, spec §3.5 / v7)', () => {
    const t = parse(
      j({ devices: [{ name: 'a', site: 'HQ' }], cables: [{ a: { site: 'HQ', device: 'a' }, b: {} }] }),
    );
    expect(t.cables?.[0]?.a).toEqual({ device: 'a' });
  });

  it('a provider_network endpoint keeps only {provider_network, id} (logical) / {provider_network} (physical)', () => {
    const t = parse(
      j({
        devices: [],
        provider_networks: [{ name: 'DX' }],
        circuits: [{ a: { provider_network: 'DX', site: 'X', interface: 'Gi0' }, b: {} }],
        logical_links: [{ a: { provider_network: 'DX', id: ' vc-1 ', vrf: 'X' }, b: {} }],
      }),
    );
    expect(t.circuits?.[0]?.a).toEqual({ provider_network: 'DX' });
    expect(t.logical_links?.[0]?.a).toEqual({ provider_network: 'DX', id: 'vc-1' });
  });
});
