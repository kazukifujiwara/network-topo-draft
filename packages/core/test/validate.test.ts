/**
 * Diagnostics rule set (plan §4.6): detection AND non-detection per rule.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { validate } from '../src/validate';
import type { Diagnostic } from '../src/validate';
import type { Topology } from '../src/model';

const codes = (ds: Diagnostic[]): string[] => ds.map((d) => d.code);
const byCode = (ds: Diagnostic[], code: string): Diagnostic[] =>
  ds.filter((d) => d.code === code);

const clean: Topology = parse(
  JSON.stringify({
    version: 1,
    devices: [
      {
        name: 'rt-1',
        site: 'HQ',
        vrfs: ['PROD'],
        interfaces: [
          { name: 'Po1', type: 'lag' },
          { name: 'Gi0/0/1', lag: 'Po1' },
          { name: 'Gi0/0/1.100', vrf: 'PROD' },
        ],
      },
      { name: 'rt-2', interfaces: [{ name: 'Gi0/0/1.100', vrf: 'PROD' }] },
    ],
    provider_networks: [{ name: 'DX' }],
    cables: [{ a: { device: 'rt-1', interface: 'Gi0/0/1' }, b: { device: 'rt-2' } }],
    circuits: [{ a: { device: 'rt-1' }, b: { provider_network: 'DX' } }],
    logical_links: [
      {
        a: { device: 'rt-1', vrf: 'PROD', interface: 'Gi0/0/1.100' },
        b: { device: 'rt-2', vrf: 'PROD' },
      },
    ],
  }),
);

describe('validate — non-detection on a clean topology', () => {
  it('reports nothing for a fully consistent v1 document', () => {
    expect(validate(clean)).toEqual([]);
  });
});

describe('E: duplicate-name', () => {
  it('flags duplicate device names (each occurrence after the first)', () => {
    const ds = validate({ devices: [{ name: 'x' }, { name: 'x' }, { name: 'x' }], version: 1 });
    const dups = byCode(ds, 'duplicate-name');
    expect(dups).toHaveLength(2);
    expect(dups[0]?.severity).toBe('error');
    expect(dups[0]?.path).toEqual(['devices', 1, 'name']);
    expect(dups[1]?.path).toEqual(['devices', 2, 'name']);
  });

  it('flags a provider network colliding with a device name (shared reference namespace)', () => {
    const ds = validate({
      version: 1,
      devices: [{ name: 'x' }],
      provider_networks: [{ name: 'x' }],
    });
    expect(byCode(ds, 'duplicate-name')).toHaveLength(1);
    expect(byCode(ds, 'duplicate-name')[0]?.path).toEqual(['provider_networks', 0, 'name']);
  });

  it('does not flag distinct names', () => {
    const ds = validate({
      version: 1,
      devices: [{ name: 'a' }, { name: 'b' }],
      provider_networks: [{ name: 'c' }],
    });
    expect(byCode(ds, 'duplicate-name')).toEqual([]);
  });
});

describe('E: dangling-reference', () => {
  it('flags endpoints referencing nonexistent devices / provider networks', () => {
    const ds = validate({
      version: 1,
      devices: [{ name: 'a' }],
      cables: [{ a: { device: 'a' }, b: { device: 'ghost' } }],
      circuits: [{ a: { provider_network: 'nope' }, b: { device: 'a' } }],
      logical_links: [{ a: { device: 'ghost' }, b: { device: 'a' } }],
    });
    const dangling = byCode(ds, 'dangling-reference');
    expect(dangling).toHaveLength(3);
    expect(dangling.every((d) => d.severity === 'error')).toBe(true);
    expect(dangling[0]?.path).toEqual(['cables', 0, 'b', 'device']);
    expect(dangling[1]?.path).toEqual(['circuits', 0, 'a', 'provider_network']);
    expect(dangling[2]?.path).toEqual(['logical_links', 0, 'a', 'device']);
  });

  it('flags an endpoint with neither device nor provider_network', () => {
    const ds = validate({ version: 1, devices: [{ name: 'a' }], cables: [{ a: {}, b: { device: 'a' } }] });
    expect(byCode(ds, 'dangling-reference')[0]?.path).toEqual(['cables', 0, 'a']);
  });

  it('does not flag resolvable references', () => {
    expect(byCode(validate(clean), 'dangling-reference')).toEqual([]);
  });
});

describe('W: missing-lag-parent', () => {
  it('flags a lag naming a parent that does not exist on the same device', () => {
    const ds = validate({
      version: 1,
      devices: [
        { name: 'a', interfaces: [{ name: 'Gi1', lag: 'Po9' }] },
        { name: 'b', interfaces: [{ name: 'Po9', type: 'lag' }] }, // parent on ANOTHER device does not count
      ],
    });
    const w = byCode(ds, 'missing-lag-parent');
    expect(w).toHaveLength(1);
    expect(w[0]?.severity).toBe('warning');
    expect(w[0]?.path).toEqual(['devices', 0, 'interfaces', 0, 'lag']);
  });

  it('does not flag when the parent exists on the same device', () => {
    expect(byCode(validate(clean), 'missing-lag-parent')).toEqual([]);
  });
});

describe('W: unknown-interface', () => {
  it('flags endpoint interfaces that do not exist on the referenced device', () => {
    const ds = validate({
      version: 1,
      devices: [{ name: 'a', interfaces: [{ name: 'Gi0' }] }, { name: 'b' }],
      cables: [{ a: { device: 'a', interface: 'Gi99' }, b: { device: 'b', interface: 'Gi0' } }],
    });
    const w = byCode(ds, 'unknown-interface');
    expect(w).toHaveLength(2); // Gi99 unknown on a; b has no interfaces at all
    expect(w[0]?.severity).toBe('warning');
    expect(w[0]?.path).toEqual(['cables', 0, 'a', 'interface']);
  });

  it('does not flag existing interfaces or endpoints without an interface', () => {
    expect(byCode(validate(clean), 'unknown-interface')).toEqual([]);
  });
});

describe('W: undeclared-vrf', () => {
  it('flags a logical endpoint vrf not in vrfs[] nor interface-derived, explaining the derivation rule', () => {
    const ds = validate({
      version: 1,
      devices: [{ name: 'a', vrfs: ['PROD'] }, { name: 'b' }],
      logical_links: [{ a: { device: 'a', vrf: 'DEV' }, b: { device: 'b', vrf: 'PROD' } }],
    });
    const w = byCode(ds, 'undeclared-vrf');
    expect(w).toHaveLength(2); // DEV undeclared on a; PROD undeclared on b
    expect(w[0]?.severity).toBe('warning');
    expect(w[0]?.path).toEqual(['logical_links', 0, 'a', 'vrf']);
    expect(w[0]?.message).toContain('vrfs[] ∪ interfaces[].vrf ∪ logical-endpoint VRFs');
  });

  it('accepts vrfs declared explicitly OR derived from an interface', () => {
    const ds = validate({
      version: 1,
      devices: [
        { name: 'a', vrfs: ['PROD'] },
        { name: 'b', interfaces: [{ name: 'Gi0.1', vrf: 'PROD' }] },
      ],
      logical_links: [{ a: { device: 'a', vrf: 'PROD' }, b: { device: 'b', vrf: 'PROD' } }],
    });
    expect(byCode(ds, 'undeclared-vrf')).toEqual([]);
  });

  it('does not flag the global routing table (empty/omitted vrf)', () => {
    const ds = validate({
      version: 1,
      devices: [{ name: 'a' }, { name: 'b' }],
      logical_links: [{ a: { device: 'a' }, b: { device: 'b' } }],
    });
    expect(byCode(ds, 'undeclared-vrf')).toEqual([]);
  });
});

describe('I: missing-version', () => {
  it('flags a legacy model (no version) with severity info and notes that saving adds it', () => {
    const ds = validate(parse('{"devices": []}'));
    const info = byCode(ds, 'missing-version');
    expect(info).toHaveLength(1);
    expect(info[0]?.severity).toBe('info');
    expect(info[0]?.message).toContain('"version": 1');
    expect(info[0]?.path).toEqual([]);
  });

  it('does not flag v1 documents', () => {
    expect(codes(validate(parse('{"version": 1, "devices": []}')))).toEqual([]);
  });
});
