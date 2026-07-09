import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serialize } from '@topodraft/core';
import {
  TOOL_DOCS,
  TOPO_FILE_RE,
  addDeviceText,
  addLinkText,
  describeFormat,
  readTopologyText,
  removeDeviceText,
  removeLinkText,
  renderSvgText,
  setPositionText,
  updateDeviceText,
  validateTopologyText,
} from '../src/tools';

const HERE = dirname(fileURLToPath(import.meta.url));
const readFixture = (p: string): string =>
  readFileSync(resolve(HERE, '../../../fixtures', p), 'utf8');

describe('describe_format', () => {
  it('returns the schema doc: rules, JSON Schema, minimal example', () => {
    const doc = describeFormat();
    expect(doc).toContain('JSON Schema');
    expect(doc).toContain('"version"');
    expect(doc).not.toMatch(/yaml/i); // ADR D2
  });
});

describe('read_topology', () => {
  it('summarizes the site-cloud fixture and embeds the canonical topology', () => {
    const r = readTopologyText(readFixture('v6v7/site-cloud.topo.json'));
    expect(r.summary.devices).toBeGreaterThan(0);
    expect(r.summary.sites).toContain('HQ');
    expect(r.summary.vrfs.length).toBeGreaterThan(0);
    expect(r.summary.diagnostics.errors).toBe(0);
    expect(r.topology.version).toBe(1);
    // canonical form: a/b endpoints first in links (approved key order)
    expect(Object.keys((r.topology.cables ?? [])[0] ?? {})[0]).toBe('a');
  });

  it('throws for text that does not parse (server maps it to isError)', () => {
    expect(() => readTopologyText('{"version":1,"devices":{}}')).toThrow();
  });
});

describe('validate_topology', () => {
  it('reports dangling references as errors (ok: false)', () => {
    const r = validateTopologyText(
      JSON.stringify({
        version: 1,
        devices: [{ name: 'a' }],
        cables: [{ a: { device: 'a' }, b: { device: 'ghost' } }],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('suggests field names for unknown fields (did-you-mean)', () => {
    const r = validateTopologyText(
      JSON.stringify({
        version: 1,
        devices: [{ name: 'a', interfaces: [{ name: 'eth0', ip: '10.0.0.1/30' }] }],
      }),
    );
    expect(r.diagnostics.some((d) => /ip_address/.test(d.message))).toBe(true);
  });

  it('reports invalid JSON with line/column instead of throwing', () => {
    const r = validateTopologyText('{ not json');
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]?.code).toBe('invalid-json');
  });
});

describe('render_svg', () => {
  it('renders the physical view byte-identically to the export golden', () => {
    expect(renderSvgText(readFixture('v6v7/site-cloud.topo.json'))).toBe(
      readFixture('expected/render/site-cloud.physical.svg'),
    );
  });

  it('renders the logical view when asked', () => {
    const svg = renderSvgText(readFixture('v3/wan-logical.topo.json'), { view: 'logical' });
    expect(svg).toContain('<svg ');
    expect(svg).toContain('stroke-dasharray="1.5 6"'); // logical link style
  });

  it('throws for text that does not parse (server maps it to isError)', () => {
    expect(() => renderSvgText('{"version":1,"devices":{}}')).toThrow();
  });
});

describe('file-name gate', () => {
  it('accepts the canonical extension and the alias, rejects others', () => {
    expect(TOPO_FILE_RE.test('net.topo.json')).toBe(true);
    expect(TOPO_FILE_RE.test('net.topo')).toBe(true);
    expect(TOPO_FILE_RE.test('net.json')).toBe(false);
    expect(TOPO_FILE_RE.test('net.yaml')).toBe(false);
  });
});

/* ---------- edit tools (#12) ---------- */

const BASE = JSON.stringify({
  version: 1,
  devices: [
    { name: 'rt-01', role: 'router', site: 'S1', position: { x: 100, y: 60 } },
    { name: 'sw-01', role: 'switch', site: 'S1', position: { x: 300, y: 60 } },
  ],
  cables: [{ a: { device: 'rt-01' }, b: { device: 'sw-01' }, type: 'cat6' }],
});

describe('add_device', () => {
  it('adds with an explicit name and fields, placed right of the diagram', () => {
    const r = addDeviceText(BASE, { name: 'fw-01', role: 'firewall', site: 'S1' });
    const t = parse(r.text);
    const fw = t.devices.find((d) => d.name === 'fw-01');
    expect(fw?.role).toBe('firewall');
    expect(fw?.site).toBe('S1');
    expect(fw?.position?.x).toBeGreaterThan(300);
    expect(r.applied).toContain('fw-01');
  });

  it('auto-generates a unique role-derived name when omitted', () => {
    const r = addDeviceText(BASE, { role: 'switch' });
    expect(parse(r.text).devices.some((d) => d.name === 'sw-01-2')).toBe(true); // sw-01 taken
  });

  it('rejects duplicate names', () => {
    expect(() => addDeviceText(BASE, { name: 'rt-01' })).toThrow(/already exists/);
  });

  it('produces canonical text (deterministic round-trip)', () => {
    const r = addDeviceText(BASE, { name: 'fw-01' });
    expect(r.text).toBe(serialize(parse(r.text)));
  });
});

describe('update_device', () => {
  it('renames and follows link references', () => {
    const r = updateDeviceText(BASE, { name: 'rt-01', new_name: 'rt-tokyo-01' });
    const t = parse(r.text);
    expect(t.devices.some((d) => d.name === 'rt-tokyo-01')).toBe(true);
    expect((t.cables ?? [])[0]?.a.device).toBe('rt-tokyo-01');
  });

  it('sets and removes fields ("" removes)', () => {
    const r = updateDeviceText(BASE, { name: 'rt-01', device_type: 'RT-X', site: '' });
    const d = parse(r.text).devices.find((x) => x.name === 'rt-01');
    expect(d?.device_type).toBe('RT-X');
    expect(d?.site).toBeUndefined();
  });

  it('rejects unknown devices and empty updates', () => {
    expect(() => updateDeviceText(BASE, { name: 'ghost', role: 'router' })).toThrow(/no device/);
    expect(() => updateDeviceText(BASE, { name: 'rt-01' })).toThrow(/nothing to change/);
  });
});

describe('remove_device', () => {
  it('removes the device and its links, reporting the count', () => {
    const r = removeDeviceText(BASE, 'rt-01');
    const t = parse(r.text);
    expect(t.devices).toHaveLength(1);
    expect(t.cables).toBeUndefined();
    expect(r.applied).toContain('1 attached link');
  });
});

describe('add_link', () => {
  it('adds a circuit with attributes', () => {
    const r = addLinkText(BASE, {
      kind: 'circuit',
      a: { device: 'rt-01', interface: 'Gi0/0/0' },
      b: { device: 'sw-01' },
      attributes: { cid: 'CID-0001', commit_rate: '1Gbps' },
    });
    const c = (parse(r.text).circuits ?? [])[0];
    expect(c?.cid).toBe('CID-0001');
    expect(c?.a.interface).toBe('Gi0/0/0');
  });

  it('rejects endpoints that reference unknown nodes', () => {
    expect(() =>
      addLinkText(BASE, { kind: 'cable', a: { device: 'rt-01' }, b: { device: 'ghost' } }),
    ).toThrow(/unknown node "ghost"/);
  });
});

describe('remove_link', () => {
  const PARALLEL = JSON.stringify({
    version: 1,
    devices: [{ name: 'a' }, { name: 'b' }],
    cables: [
      { a: { device: 'a' }, b: { device: 'b' }, label: 'L1' },
      { a: { device: 'a' }, b: { device: 'b' }, label: 'L2' },
    ],
  });

  it('removes a uniquely matching link (order-insensitive)', () => {
    const r = removeLinkText(BASE, { kind: 'cable', a_name: 'sw-01', b_name: 'rt-01' });
    expect(parse(r.text).cables).toBeUndefined();
  });

  it('demands match_index for parallel links, then honors it', () => {
    expect(() => removeLinkText(PARALLEL, { kind: 'cable', a_name: 'a', b_name: 'b' })).toThrow(
      /match_index/,
    );
    const r = removeLinkText(PARALLEL, {
      kind: 'cable',
      a_name: 'a',
      b_name: 'b',
      match_index: 1,
    });
    expect((parse(r.text).cables ?? [])[0]?.label).toBe('L1');
  });

  it('rejects when nothing matches', () => {
    expect(() =>
      removeLinkText(BASE, { kind: 'circuit', a_name: 'rt-01', b_name: 'sw-01' }),
    ).toThrow(/no circuit link/);
  });
});

describe('set_position', () => {
  it('moves devices and reports the move', () => {
    const r = setPositionText(BASE, 'sw-01', 500, 200);
    expect(parse(r.text).devices.find((d) => d.name === 'sw-01')?.position).toEqual({
      x: 500,
      y: 200,
    });
    expect(r.applied).toContain('(500, 200)');
  });

  it('rejects unknown nodes', () => {
    expect(() => setPositionText(BASE, 'ghost', 0, 0)).toThrow(/no node/);
  });
});

describe('tool docs policy', () => {
  it('never names third-party vendors or tools (same guard as templates/guide)', () => {
    const banned =
      /(aws|azure|gcp|oci\b|oracle|equinix|direct\s*connect|fastconnect|megaport|ntt|tgw\b|dxvif|dxcon|cisco|juniper|arista|catalyst|nexus|ios-xe|junos|draw\.io|excalidraw|mermaid|\bvisio\b|lucidchart)/i;
    for (const doc of Object.values(TOOL_DOCS)) {
      for (const s of Object.values(doc)) {
        expect(banned.exec(s), s).toBeNull();
      }
    }
  });
});
