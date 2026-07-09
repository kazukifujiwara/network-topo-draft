import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOOL_DOCS,
  TOPO_FILE_RE,
  describeFormat,
  readTopologyText,
  renderSvgText,
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
