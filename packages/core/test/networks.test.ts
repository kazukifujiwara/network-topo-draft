/**
 * Multi-access L3 segments (spec §3.10): the networks[] object, the
 * {network} logical endpoint shape, FHRP, prefix-containment diagnostics,
 * and the operations that keep references intact.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import { serialize } from '../src/serialize';
import { validate } from '../src/validate';
import { findUnknownFields } from '../src/unknownFields';
import { ipv4InCidr, parseIpv4 } from '../src/cidr';
import { deleteNodes, makeClipboard, pasteClipboard, renameNetwork, addNetwork } from '../src/operations';

const HSRP = JSON.stringify({
  version: 1,
  devices: [
    {
      name: 'rt-1',
      vrfs: ['PROD'],
      interfaces: [{ name: 'Gi0.100', ip_address: '10.0.0.2/28', vrf: 'PROD' }],
    },
    {
      name: 'rt-2',
      vrfs: ['PROD'],
      interfaces: [{ name: 'Gi0.100', ip_address: '10.0.0.3/28', vrf: 'PROD' }],
    },
  ],
  networks: [
    {
      name: 'seg-1',
      prefix: '10.0.0.0/28',
      vlan: '100',
      fhrp: { protocol: 'hsrp', group: '1', virtual_ip: '10.0.0.1/28' },
    },
  ],
  logical_links: [
    { a: { device: 'rt-1', vrf: 'PROD', interface: 'Gi0.100' }, b: { network: 'seg-1' } },
    { a: { device: 'rt-2', vrf: 'PROD', interface: 'Gi0.100' }, b: { network: 'seg-1' } },
  ],
});

describe('parse/serialize networks', () => {
  it('round-trips an HSRP segment canonically and diagnostic-clean', () => {
    const t = parse(HSRP);
    expect(t.networks?.[0]?.fhrp?.virtual_ip).toBe('10.0.0.1/28');
    expect(validate(t)).toEqual([]);
    const once = serialize(t);
    expect(serialize(parse(once))).toBe(once);
    // canonical key orders
    const out = JSON.parse(once);
    expect(Object.keys(out)).toEqual(['version', 'devices', 'networks', 'logical_links']);
    expect(Object.keys(out.networks[0])).toEqual(['name', 'prefix', 'vlan', 'fhrp']);
    expect(Object.keys(out.networks[0].fhrp)).toEqual(['protocol', 'group', 'virtual_ip']);
  });

  it('a {network} endpoint is exclusive — other fields are dropped', () => {
    const t = parse(
      JSON.stringify({
        version: 1,
        devices: [],
        networks: [{ name: 'seg' }],
        logical_links: [{ a: { network: 'seg', vrf: 'X', ip_address: 'y' }, b: {} }],
      }),
    );
    expect(t.logical_links?.[0]?.a).toEqual({ network: 'seg' });
  });

  it('empty fhrp objects and empty fields are omitted; fallback name is net-N', () => {
    const t = parse(
      JSON.stringify({ version: 1, devices: [], networks: [{ fhrp: { protocol: '' }, vlan: '' }] }),
    );
    expect(t.networks?.[0]).toEqual({ name: 'net-1' });
  });
});

describe('validate networks', () => {
  it('flags dangling {network} references', () => {
    const ds = validate(
      parse(
        JSON.stringify({
          version: 1,
          devices: [{ name: 'a' }],
          logical_links: [{ a: { device: 'a' }, b: { network: 'ghost' } }],
        }),
      ),
    );
    expect(ds).toMatchObject([
      { code: 'dangling-reference', path: ['logical_links', 0, 'b', 'network'] },
    ]);
  });

  it('networks share the name namespace with devices', () => {
    const ds = validate(
      parse(JSON.stringify({ version: 1, devices: [{ name: 'x' }], networks: [{ name: 'x' }] })),
    );
    expect(ds[0]).toMatchObject({ code: 'duplicate-name', path: ['networks', 0, 'name'] });
  });

  it('warns when an attached interface IP is outside the prefix — and points at that IP', () => {
    const bad = HSRP.replace('10.0.0.3/28', '10.0.9.3/28');
    const ds = validate(parse(bad));
    expect(ds).toMatchObject([
      {
        code: 'ip-outside-prefix',
        severity: 'warning',
        path: ['devices', 1, 'interfaces', 0, 'ip_address'],
      },
    ]);
    expect(ds[0]?.message).toContain('10.0.9.3/28');
    expect(ds[0]?.message).toContain('seg-1');
  });

  it('warns when an endpoint-held IP or the virtual IP is outside the prefix', () => {
    const ds = validate(
      parse(
        JSON.stringify({
          version: 1,
          devices: [{ name: 'a' }],
          networks: [
            { name: 'seg', prefix: '10.0.0.0/28', fhrp: { virtual_ip: '192.168.1.1/28' } },
          ],
          logical_links: [{ a: { device: 'a', ip_address: '10.0.1.9/28' }, b: { network: 'seg' } }],
        }),
      ),
    );
    const codes = ds.map((d) => d.code);
    expect(codes.filter((c) => c === 'ip-outside-prefix')).toHaveLength(2);
    expect(ds.find((d) => d.path.includes('virtual_ip'))).toBeTruthy();
  });

  it('stays silent for non-IPv4 values and prefix-less segments (cannot determine)', () => {
    const ds = validate(
      parse(
        JSON.stringify({
          version: 1,
          devices: [{ name: 'a' }],
          networks: [{ name: 'seg', fhrp: { virtual_ip: '2001:db8::1/64' } }],
          logical_links: [{ a: { device: 'a', ip_address: 'dhcp' }, b: { network: 'seg' } }],
        }),
      ),
    );
    expect(ds.filter((d) => d.code === 'ip-outside-prefix')).toEqual([]);
  });
});

describe('unknown fields in networks', () => {
  it('suggests fixes inside networks[] and fhrp', () => {
    const findings = findUnknownFields({
      version: 1,
      devices: [],
      networks: [{ name: 's', prefx: '10.0.0.0/28', fhrp: { vip: '10.0.0.1' } }],
    });
    const byField = Object.fromEntries(findings.map((f) => [f.field, f.suggestion]));
    expect(byField).toEqual({ prefx: 'prefix', vip: 'virtual_ip' });
  });
});

describe('operations on networks', () => {
  it('renameNetwork follows logical endpoint references', () => {
    const t = renameNetwork(parse(HSRP), 'seg-1', 'svc-seg');
    expect(t.networks?.[0]?.name).toBe('svc-seg');
    expect(t.logical_links?.every((l) => l.b.network === 'svc-seg')).toBe(true);
  });

  it('deleting a network removes its attachment links', () => {
    const t = deleteNodes(parse(HSRP), ['seg-1']);
    expect(t.networks).toBeUndefined();
    expect(t.logical_links).toBeUndefined();
    expect(t.devices).toHaveLength(2);
  });

  it('clipboard copies segments and remaps attachments on paste', () => {
    const t = parse(HSRP);
    const clip = makeClipboard(t, ['rt-1', 'rt-2', 'seg-1']);
    expect(clip.networks).toHaveLength(1);
    const { topology, renames } = pasteClipboard(t, clip, 1000, 1000);
    expect(renames.get('seg-1')).toBe('seg-1-2');
    expect(topology.logical_links?.filter((l) => l.b.network === 'seg-1-2')).toHaveLength(2);
  });

  it('addNetwork places a uniquely named segment', () => {
    const { topology, name } = addNetwork(parse(HSRP), 13, 27);
    expect(name).toBe('seg-01');
    expect(topology.networks?.[1]).toEqual({ name: 'seg-01', position: { x: 10, y: 30 } });
  });
});

describe('cidr math', () => {
  it('parses IPv4 with or without /len', () => {
    expect(parseIpv4('10.0.0.1')).toBe((10 << 24) + 1);
    expect(parseIpv4('10.0.0.1/28')).toBe((10 << 24) + 1);
    expect(parseIpv4('10.0.0.256')).toBeNull();
    expect(parseIpv4('2001:db8::1')).toBeNull();
  });

  it('checks containment and returns null when undeterminable', () => {
    expect(ipv4InCidr('10.0.0.14/28', '10.0.0.0/28')).toBe(true);
    expect(ipv4InCidr('10.0.0.17', '10.0.0.0/28')).toBe(false);
    expect(ipv4InCidr('anything', '10.0.0.0/28')).toBeNull();
    expect(ipv4InCidr('10.0.0.1', 'no-prefix')).toBeNull();
    expect(ipv4InCidr('10.0.0.1', '10.0.0.0/0')).toBe(true);
  });
});
