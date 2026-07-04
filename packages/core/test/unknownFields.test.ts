/**
 * Unknown-field detection (format spec §7: parse drops unknown fields and
 * diagnostics must warn) with did-you-mean suggestions for agents.
 */
import { describe, expect, it } from 'vitest';
import { findUnknownFields, suggestField } from '../src/unknownFields';

describe('findUnknownFields', () => {
  it('returns nothing for canonical documents', () => {
    expect(
      findUnknownFields({
        version: 1,
        devices: [
          {
            name: 'a',
            vrfs: ['V'],
            interfaces: [{ name: 'Gi0', ip_address: '10.0.0.1/30' }],
            position: { x: 1, y: 2 },
          },
        ],
        logical_links: [{ a: { device: 'a', vrf: 'V' }, b: { device: 'a', ip_address: 'x' } }],
      }),
    ).toEqual([]);
  });

  it("catches the real-world agent mistake: 'ip' instead of 'ip_address' on logical endpoints", () => {
    const findings = findUnknownFields({
      version: 1,
      devices: [{ name: 'a' }],
      logical_links: [
        { a: { device: 'a', vrf: 'V', ip: '10.1.3.1/30' }, b: { provider_network: 'AWS', ip: 'x' } },
      ],
    });
    expect(findings).toEqual([
      { path: ['logical_links', 0, 'a', 'ip'], field: 'ip', suggestion: 'ip_address' },
      { path: ['logical_links', 0, 'b', 'ip'], field: 'ip', suggestion: 'ip_address' },
    ]);
  });

  it('suggests fixes for typos across object kinds', () => {
    const findings = findUnknownFields({
      version: 1,
      devices: [{ name: 'a', rol: 'router', interfaces: [{ nane: 'Gi0' }] }],
      cables: [{ a: { devcie: 'a' }, b: { device: 'a' }, bandwith: '10G' }],
    });
    const byField = Object.fromEntries(findings.map((f) => [f.field, f.suggestion]));
    expect(byField).toEqual({
      rol: 'role',
      nane: 'name',
      devcie: 'device',
      bandwith: 'bandwidth',
    });
  });

  it('never descends into config_context (free-form by contract, spec §3.3)', () => {
    expect(
      findUnknownFields({
        version: 1,
        devices: [{ name: 'a', config_context: { anything: { ip: 1, totally: ['free'] } } }],
      }),
    ).toEqual([]);
  });

  it('accepts the legacy v3 top-level vrf on logical links without warning', () => {
    expect(
      findUnknownFields({
        version: 1,
        devices: [{ name: 'a' }],
        logical_links: [{ vrf: 'PROD', a: { device: 'a' }, b: { device: 'a' } }],
      }),
    ).toEqual([]);
  });

  it('flags unknown top-level fields', () => {
    const findings = findUnknownFields({ version: 1, devices: [], nodes: [] });
    expect(findings[0]).toMatchObject({ path: ['nodes'], field: 'nodes' });
  });
});

describe('suggestField', () => {
  it('prefers prefix matches, then small typos, then gives up', () => {
    expect(suggestField('ip', ['ip_address', 'interface'])).toBe('ip_address');
    expect(suggestField('interface_name', ['interface', 'name'])).toBe('interface');
    expect(suggestField('stauts', ['status', 'type'])).toBe('status');
    expect(suggestField('completely_wrong', ['a', 'b'])).toBeUndefined();
  });
});
