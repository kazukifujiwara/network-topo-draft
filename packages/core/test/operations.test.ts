import { describe, expect, it } from 'vitest';
import { parse } from '../src/parse';
import {
  addDevice,
  addProviderNetwork,
  alignCol,
  alignRow,
  autoLayout,
  deleteLink,
  deleteNodes,
  distributeH,
  distributeV,
  needsAutoLayout,
  renameDevice,
  renameProviderNetwork,
  renameSite,
  setLogicalEndpointInterface,
  setLogicalEndpointIp,
  uniqueName,
} from '../src/operations';
import type { Topology } from '../src/model';

const base = (): Topology =>
  parse(
    JSON.stringify({
      version: 1,
      devices: [
        { name: 'rt-1', site: 'HQ', vrfs: ['PROD'], interfaces: [{ name: 'Gi0' }], position: { x: 0, y: 0 } },
        { name: 'rt-2', site: 'DC', position: { x: 100, y: 40 } },
        { name: 'sw-1', site: 'HQ', position: { x: 200, y: 80 } },
      ],
      provider_networks: [{ name: 'DX', position: { x: 300, y: 0 } }],
      cables: [{ a: { device: 'rt-1', interface: 'Gi0' }, b: { device: 'sw-1' } }],
      circuits: [{ a: { device: 'rt-1' }, b: { provider_network: 'DX' } }],
      logical_links: [
        { a: { device: 'rt-1', vrf: 'PROD' }, b: { device: 'rt-2' } },
        { a: { device: 'rt-2' }, b: { provider_network: 'DX', id: 'vc-1' } },
      ],
    }),
  );

describe('operations are pure', () => {
  it('never mutates the input topology', () => {
    const t = base();
    const snapshot = JSON.stringify(t);
    renameDevice(t, 'rt-1', 'renamed');
    renameProviderNetwork(t, 'DX', 'DX2');
    renameSite(t, 'HQ', 'HQ2');
    deleteNodes(t, ['rt-1']);
    deleteLink(t, 'cables', 0);
    addDevice(t, 'router', 10, 10);
    addProviderNetwork(t, 10, 10);
    setLogicalEndpointIp(t, 0, 'a', '10.0.0.1/30');
    setLogicalEndpointInterface(t, 0, 'a', 'Gi0');
    alignRow(t, ['rt-1', 'rt-2']);
    alignCol(t, ['rt-1', 'rt-2']);
    distributeH(t, ['rt-1', 'rt-2', 'sw-1']);
    distributeV(t, ['rt-1', 'rt-2', 'sw-1']);
    autoLayout(t);
    expect(JSON.stringify(t)).toBe(snapshot);
  });
});

describe('rename with reference-following (ADR D10)', () => {
  it('renaming a device updates every endpoint referencing it', () => {
    const t = renameDevice(base(), 'rt-1', 'core-rt');
    expect(t.devices[0]?.name).toBe('core-rt');
    expect(t.cables?.[0]?.a.device).toBe('core-rt');
    expect(t.circuits?.[0]?.a.device).toBe('core-rt');
    expect(t.logical_links?.[0]?.a.device).toBe('core-rt');
    // untouched references stay
    expect(t.cables?.[0]?.b.device).toBe('sw-1');
    expect(t.logical_links?.[0]?.b.device).toBe('rt-2');
  });

  it('renaming a provider network updates circuit and logical endpoints', () => {
    const t = renameProviderNetwork(base(), 'DX', 'AWS DX');
    expect(t.provider_networks?.[0]?.name).toBe('AWS DX');
    expect(t.circuits?.[0]?.b.provider_network).toBe('AWS DX');
    expect(t.logical_links?.[1]?.b.provider_network).toBe('AWS DX');
  });

  it('renaming a nonexistent node is a no-op', () => {
    expect(renameDevice(base(), 'ghost', 'x')).toEqual(base());
    expect(renameProviderNetwork(base(), 'ghost', 'x')).toEqual(base());
  });

  it('renameSite moves every device on the site (v7 site inline-rename)', () => {
    const t = renameSite(base(), 'HQ', 'Tokyo');
    expect(t.devices.map((d) => d.site)).toEqual(['Tokyo', 'DC', 'Tokyo']);
  });
});

describe('uniqueName / add / delete (ported v7 behavior)', () => {
  it('uniqueName counts devices AND provider networks: base, base-2, …', () => {
    const t = base();
    expect(uniqueName(t, 'fresh')).toBe('fresh');
    expect(uniqueName(t, 'rt-1')).toBe('rt-1-2');
    expect(uniqueName(t, 'DX')).toBe('DX-2');
  });

  it('addDevice derives the default name from the role and snaps the position', () => {
    const { topology, name } = addDevice(base(), 'router', 13, 27);
    expect(name).toBe('rt-01');
    const added = topology.devices.find((d) => d.name === name);
    expect(added).toEqual({ name: 'rt-01', role: 'router', position: { x: 10, y: 30 } });
    // a second router gets a suffixed name
    expect(addDevice(topology, 'router', 0, 0).name).toBe('rt-01-2');
  });

  it('addProviderNetwork uses the pnet-01 base name', () => {
    expect(addProviderNetwork(base(), 0, 0).name).toBe('pnet-01');
  });

  it('deleteNodes removes the nodes and every link attached to them', () => {
    const t = deleteNodes(base(), ['rt-1']);
    expect(t.devices.map((d) => d.name)).toEqual(['rt-2', 'sw-1']);
    expect(t.cables).toBeUndefined(); // was attached to rt-1
    expect(t.circuits).toBeUndefined();
    expect(t.logical_links).toHaveLength(1); // rt-2 ↔ DX survives
  });

  it('deleteNodes on a provider network removes its circuits/logical links', () => {
    const t = deleteNodes(base(), ['DX']);
    expect(t.provider_networks).toBeUndefined();
    expect(t.circuits).toBeUndefined();
    expect(t.logical_links).toHaveLength(1);
  });

  it('deleteLink removes by collection and index, dropping an emptied collection', () => {
    const t = deleteLink(base(), 'logical_links', 0);
    expect(t.logical_links).toHaveLength(1);
    expect(t.logical_links?.[0]?.b.provider_network).toBe('DX');
    expect(deleteLink(t, 'logical_links', 0).logical_links).toBeUndefined();
  });
});

describe('logical endpoint semantics (v7 link panel, plan test list)', () => {
  it('setLogicalEndpointIp without an interface keeps the IP on the endpoint', () => {
    const t = setLogicalEndpointIp(base(), 0, 'a', '169.254.0.1/30');
    expect(t.logical_links?.[0]?.a.ip_address).toBe('169.254.0.1/30');
    expect(t.devices[0]?.interfaces).toEqual([{ name: 'Gi0' }]);
  });

  it('setLogicalEndpointIp with an interface writes through to the device (creating it), VRF included', () => {
    let t = setLogicalEndpointInterface(base(), 0, 'a', 'Gi0.100');
    t = setLogicalEndpointIp(t, 0, 'a', '169.254.0.1/30');
    const rt1 = t.devices[0];
    expect(rt1?.interfaces).toEqual([
      { name: 'Gi0' },
      { name: 'Gi0.100', ip_address: '169.254.0.1/30', vrf: 'PROD' },
    ]);
    expect(t.logical_links?.[0]?.a.ip_address).toBeUndefined();
  });

  it('naming an interface migrates an endpoint-held IP onto the device (v7 behavior)', () => {
    let t = setLogicalEndpointIp(base(), 0, 'a', '169.254.0.1/30'); // held on endpoint
    t = setLogicalEndpointInterface(t, 0, 'a', 'Gi0.200');
    expect(t.devices[0]?.interfaces).toEqual([
      { name: 'Gi0' },
      { name: 'Gi0.200', ip_address: '169.254.0.1/30', vrf: 'PROD' },
    ]);
    expect(t.logical_links?.[0]?.a.ip_address).toBeUndefined();
    expect(t.logical_links?.[0]?.a.interface).toBe('Gi0.200');
  });

  it('migration does not overwrite an existing interface IP', () => {
    let t = base();
    t.devices[0]?.interfaces?.push({ name: 'Gi0.300', ip_address: '10.9.9.9/30' });
    t = setLogicalEndpointIp(t, 0, 'a', '169.254.0.1/30');
    t = setLogicalEndpointInterface(t, 0, 'a', 'Gi0.300');
    const f = t.devices[0]?.interfaces?.find((x) => x.name === 'Gi0.300');
    expect(f?.ip_address).toBe('10.9.9.9/30');
    expect(t.logical_links?.[0]?.a.ip_address).toBeUndefined();
  });
});

describe('arrange (v7 alignRow/alignCol/distH/distV)', () => {
  it('alignRow sets the snapped mean Y on every node', () => {
    const t = alignRow(base(), ['rt-1', 'rt-2', 'sw-1']);
    // mean of 0, 40, 80 = 40
    expect(t.devices.map((d) => d.position?.y)).toEqual([40, 40, 40]);
  });

  it('alignCol sets the snapped mean X', () => {
    const t = alignCol(base(), ['rt-1', 'rt-2', 'sw-1']);
    expect(t.devices.map((d) => d.position?.x)).toEqual([100, 100, 100]);
  });

  it('distributeH spaces nodes evenly between the extremes (3+ nodes)', () => {
    const t = distributeH(base(), ['rt-1', 'sw-1', 'rt-2']);
    expect(t.devices.map((d) => d.position?.x)).toEqual([0, 100, 200]);
  });

  it('distributeV spaces nodes evenly between the extremes', () => {
    const t = distributeV(base(), ['rt-1', 'sw-1', 'rt-2']);
    expect(t.devices.map((d) => d.position?.y)).toEqual([0, 40, 80]);
  });

  it('align needs ≥2 and distribute needs ≥3 nodes (no-ops otherwise)', () => {
    expect(alignRow(base(), ['rt-1'])).toEqual(base());
    expect(distributeH(base(), ['rt-1', 'rt-2'])).toEqual(base());
  });
});

describe('auto layout (initial placement only, plan §3)', () => {
  it('needsAutoLayout is true iff some node lacks a position', () => {
    expect(needsAutoLayout(base())).toBe(false);
    const t = parse(JSON.stringify({ version: 1, devices: [{ name: 'a' }] }));
    expect(needsAutoLayout(t)).toBe(true);
  });

  it('assigns deterministic site-grouped positions to every node', () => {
    const t = parse(
      JSON.stringify({
        version: 1,
        devices: [
          { name: 'a', site: 'S1' },
          { name: 'b', site: 'S1' },
          { name: 'c', site: 'S2' },
        ],
        provider_networks: [{ name: 'p' }],
      }),
    );
    const once = autoLayout(t);
    expect(autoLayout(t)).toEqual(once); // deterministic
    const all = [...once.devices, ...(once.provider_networks ?? [])];
    expect(all.every((n) => n.position !== undefined)).toBe(true);
    // same site → same group origin; different sites → different origins
    expect(once.devices[0]?.position).toEqual({ x: 44, y: 44 });
    expect(once.devices[1]?.position).toEqual({ x: 254, y: 44 });
    expect(once.devices[0]?.position).not.toEqual(once.devices[2]?.position);
  });
});
