import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import {
  allVrfs,
  deriveDeviceVrfs,
  findDevice,
  findProviderNetwork,
  iconKey,
  sitesList,
} from '../src/model';

describe('lookups resolve by name to the FIRST occurrence', () => {
  const t = parse(
    JSON.stringify({
      version: 1,
      devices: [{ name: 'x', role: 'first' }, { name: 'x', role: 'second' }],
      provider_networks: [{ name: 'p', provider: 'AWS' }],
    }),
  );
  it('findDevice', () => {
    expect(findDevice(t, 'x')?.role).toBe('first');
    expect(findDevice(t, 'ghost')).toBeUndefined();
  });
  it('findProviderNetwork', () => {
    expect(findProviderNetwork(t, 'p')?.provider).toBe('AWS');
    expect(findProviderNetwork(t, 'ghost')).toBeUndefined();
    expect(findProviderNetwork({ version: 1, devices: [] }, 'p')).toBeUndefined();
  });
});

describe('VRF derivation (spec §3.9, v7 devVrfs)', () => {
  const t = parse(
    JSON.stringify({
      version: 1,
      devices: [
        {
          name: 'rt-1',
          vrfs: ['EXPLICIT', '  TRIMMED  ', ''],
          interfaces: [{ name: 'Gi0', vrf: 'FROM-IF' }, { name: 'Gi1' }],
        },
        { name: 'rt-2' },
      ],
      logical_links: [
        { a: { device: 'rt-1', vrf: 'FROM-LINK' }, b: { device: 'rt-2', vrf: 'OTHER-END' } },
        { a: { device: 'rt-2' }, b: { device: 'rt-1', vrf: 'FROM-LINK-B' } },
      ],
    }),
  );

  it('is the union of vrfs[] ∪ interfaces[].vrf ∪ logical endpoint vrfs, in that order', () => {
    expect(deriveDeviceVrfs(t, 'rt-1')).toEqual([
      'EXPLICIT',
      'TRIMMED',
      'FROM-IF',
      'FROM-LINK',
      'FROM-LINK-B',
    ]);
  });

  it('a device with no explicit vrfs still derives from links (agents need not declare, spec §3.9)', () => {
    expect(deriveDeviceVrfs(t, 'rt-2')).toEqual(['OTHER-END']);
  });

  it('deduplicates across sources', () => {
    const t2 = parse(
      JSON.stringify({
        version: 1,
        devices: [{ name: 'a', vrfs: ['X'], interfaces: [{ name: 'i', vrf: 'X' }] }],
        logical_links: [{ a: { device: 'a', vrf: 'X' }, b: {} }],
      }),
    );
    expect(deriveDeviceVrfs(t2, 'a')).toEqual(['X']);
  });

  it('returns [] for unknown devices', () => {
    expect(deriveDeviceVrfs(t, 'ghost')).toEqual([]);
  });

  it('allVrfs unions across devices in device order', () => {
    expect(allVrfs(t)).toEqual([
      'EXPLICIT',
      'TRIMMED',
      'FROM-IF',
      'FROM-LINK',
      'FROM-LINK-B',
      'OTHER-END',
    ]);
  });
});

describe('sitesList', () => {
  it('collects unique trimmed sites in first-appearance order', () => {
    const t = parse(
      JSON.stringify({
        version: 1,
        devices: [
          { name: 'a', site: 'HQ' },
          { name: 'b', site: 'DC' },
          { name: 'c', site: 'HQ' },
          { name: 'd' },
        ],
      }),
    );
    expect(sitesList(t)).toEqual(['HQ', 'DC']);
  });
});

describe('iconKey (v7 role classification)', () => {
  it('classifies roles by the v7 regexes', () => {
    expect(iconKey('firewall')).toBe('firewall');
    expect(iconKey('waf')).toBe('firewall');
    expect(iconKey('l3 switch')).toBe('switch');
    expect(iconKey('router')).toBe('router');
    expect(iconKey('edge')).toBe('router');
    expect(iconKey('aws external_peer')).toBe('cloud');
    expect(iconKey('load balancer')).toBe('server');
    expect(iconKey('')).toBe('generic');
    expect(iconKey(undefined)).toBe('generic');
  });
});
