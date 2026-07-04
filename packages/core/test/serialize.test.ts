import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { serialize, toCanonical } from '../src/serialize';
import type { Topology } from '../src/model';

describe('serialize — canonical rules (format spec §4)', () => {
  it('emits 2-space indented LF text with exactly one trailing newline', () => {
    const out = serialize({ devices: [] });
    expect(out).toBe('{\n  "version": 1,\n  "devices": []\n}\n');
    expect(out.includes('\r')).toBe(false);
  });

  it('always writes version 1, normalizing legacy models on save (ADR D9)', () => {
    const legacy = parse('{"devices": []}');
    expect(legacy.version).toBeUndefined();
    expect(JSON.parse(serialize(legacy)).version).toBe(1);
  });

  it('passes $schema through verbatim when present, first in key order', () => {
    const url = 'https://example.com/topodraft.schema.json';
    const out = serialize({ $schema: url, devices: [] });
    expect(Object.keys(JSON.parse(out))).toEqual(['$schema', 'version', 'devices']);
    expect(out.startsWith(`{\n  "$schema": "${url}",\n  "version": 1,`)).toBe(true);
  });

  it('orders top-level keys $schema → version → devices → provider_networks → cables → circuits → logical_links', () => {
    const t: Topology = {
      logical_links: [{ a: {}, b: {} }],
      circuits: [{ a: {}, b: {} }],
      cables: [{ a: {}, b: {} }],
      provider_networks: [{ name: 'p' }],
      devices: [{ name: 'd' }],
      $schema: 'x',
    } as Topology;
    expect(Object.keys(JSON.parse(serialize(t)))).toEqual([
      '$schema',
      'version',
      'devices',
      'provider_networks',
      'cables',
      'circuits',
      'logical_links',
    ]);
  });

  it('orders device keys per the §3.1 table, position always last', () => {
    const t: Topology = {
      devices: [
        {
          position: { x: 1, y: 2 },
          config_context: { a: 1 },
          interfaces: [{ vrf: 'V', lag: 'Po1', description: 'd', type: 't', ip_address: 'ip', name: 'n' }],
          vrfs: ['V'],
          platform: 'os',
          tenant: 'ten',
          site: 's',
          role: 'r',
          device_type: 'dt',
          name: 'dev',
        } as Topology['devices'][0],
      ],
    };
    const d = JSON.parse(serialize(t)).devices[0];
    expect(Object.keys(d)).toEqual([
      'name',
      'device_type',
      'role',
      'site',
      'tenant',
      'platform',
      'vrfs',
      'interfaces',
      'config_context',
      'position',
    ]);
    expect(Object.keys(d.interfaces[0])).toEqual([
      'name',
      'ip_address',
      'type',
      'description',
      'lag',
      'vrf',
    ]);
  });

  it('orders link keys with a/b endpoints first (§4 rule 3 ruling)', () => {
    const t: Topology = {
      devices: [{ name: 'x', site: 'S' }],
      cables: [{ label: 'l', status: 's', bandwidth: 'b', type: 't', b: {}, a: { device: 'x' } } as never],
      circuits: [
        { status: 's', commit_rate: 'c', type: 't', provider: 'p', cid: 'i', b: {}, a: { device: 'x' } } as never,
      ],
      logical_links: [
        { description: 'd', label: 'l', vlan: 'v', link_id: 'i', b: {}, a: { device: 'x' } } as never,
      ],
    };
    const out = JSON.parse(serialize(t));
    expect(Object.keys(out.cables[0])).toEqual(['a', 'b', 'type', 'bandwidth', 'status', 'label']);
    expect(Object.keys(out.circuits[0])).toEqual([
      'a',
      'b',
      'cid',
      'provider',
      'type',
      'commit_rate',
      'status',
    ]);
    expect(Object.keys(out.logical_links[0])).toEqual([
      'a',
      'b',
      'link_id',
      'vlan',
      'label',
      'description',
    ]);
    // circuit device endpoint: site → device → interface
    expect(Object.keys(out.circuits[0].a)).toEqual(['site', 'device']);
  });

  it('omits empty strings, arrays, and objects — but preserves config_context contents verbatim', () => {
    const t: Topology = {
      devices: [
        {
          name: 'd',
          role: '',
          vrfs: [],
          interfaces: [{}],
          config_context: { keep: '', nested: { alsoEmpty: [] } },
        },
      ],
      cables: [],
    };
    const out = JSON.parse(serialize(t));
    expect(out.devices[0]).toEqual({
      name: 'd',
      config_context: { keep: '', nested: { alsoEmpty: [] } },
    });
    expect(out.cables).toBeUndefined();
  });

  it('never re-sorts arrays (§4 rule 4)', () => {
    const t: Topology = {
      devices: [{ name: 'z' }, { name: 'a' }],
      cables: [
        { a: { device: 'z' }, b: { device: 'a' } },
        { a: { device: 'a' }, b: { device: 'z' } },
      ],
    };
    const out = JSON.parse(serialize(t));
    expect(out.devices.map((d: { name: string }) => d.name)).toEqual(['z', 'a']);
    expect(out.cables[0].a.device).toBe('z');
  });

  it('re-derives the circuit endpoint site from the device; keeps the stored one only for dangling refs', () => {
    const t: Topology = {
      devices: [{ name: 'rt', site: 'NEW' }],
      circuits: [
        { a: { site: 'STALE', device: 'rt' }, b: { site: 'KEPT', device: 'ghost' } },
      ],
    };
    const out = JSON.parse(serialize(t));
    expect(out.circuits[0].a).toEqual({ site: 'NEW', device: 'rt' });
    expect(out.circuits[0].b).toEqual({ site: 'KEPT', device: 'ghost' });
  });

  it('rounds positions to integers', () => {
    const t: Topology = { devices: [{ name: 'd', position: { x: 1.4, y: 2.6 } }] };
    expect(JSON.parse(serialize(t)).devices[0].position).toEqual({ x: 1, y: 3 });
  });
});

describe('serialize — determinism & idempotence (plan §6.2 ③)', () => {
  const sample = JSON.stringify({
    devices: [
      { name: 'a', site: 'S1', vrfs: ['V'], interfaces: [{ name: 'Gi0', ip_address: '10.0.0.1/30' }] },
      { name: 'b', site: 'S2' },
    ],
    provider_networks: [{ name: 'DX', provider: 'AWS' }],
    cables: [{ a: { device: 'a', interface: 'Gi0' }, b: { device: 'b' }, type: 'smf' }],
    circuits: [{ cid: 'C1', a: { device: 'a' }, b: { provider_network: 'DX' } }],
    logical_links: [{ vrf: 'V', a: { device: 'a' }, b: { device: 'b' } }],
  });

  it('identical model → byte-identical output across runs', () => {
    const m = parse(sample);
    expect(serialize(m)).toBe(serialize(m));
    expect(serialize(parse(sample))).toBe(serialize(parse(sample)));
  });

  it('serialize(parse(text)) is idempotent at the byte level', () => {
    const once = serialize(parse(sample));
    const twice = serialize(parse(once));
    expect(twice).toBe(once);
  });

  it('parse(serialize(m)) ≡ m for canonical models (round-trip equivalence)', () => {
    const m = parse(serialize(parse(sample))); // canonical model (version present)
    expect(parse(serialize(m))).toEqual(m);
  });

  it('toCanonical does not mutate its input', () => {
    const m = parse(sample);
    const snapshot = JSON.stringify(m);
    toCanonical(m);
    serialize(m);
    expect(JSON.stringify(m)).toBe(snapshot);
  });
});
