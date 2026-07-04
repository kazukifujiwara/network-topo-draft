/**
 * JSON-path → text-range resolution for the Problems panel (plan §4.6 —
 * detection ranges must point at the offending text so agents can
 * self-correct precisely).
 */
import { describe, expect, it } from 'vitest';
import { computeOffsetDiagnostics } from '../src/diagnostics';

const at = (text: string, d: { start: number; length: number }): string =>
  text.slice(d.start, d.start + d.length);

describe('computeOffsetDiagnostics', () => {
  it('returns [] for invalid JSON (the JSON language service owns syntax errors)', () => {
    expect(computeOffsetDiagnostics('{ not json')).toEqual([]);
    expect(computeOffsetDiagnostics('{"devices": 3}')).toEqual([]); // TopoParseError too
  });

  it('returns [] for a clean document', () => {
    expect(
      computeOffsetDiagnostics('{"version": 1, "devices": [{"name": "a"}]}'),
    ).toEqual([]);
  });

  it('points dangling references at the exact reference value', () => {
    const text = JSON.stringify(
      {
        version: 1,
        devices: [{ name: 'a' }],
        cables: [{ a: { device: 'a' }, b: { device: 'ghost' } }],
      },
      null,
      2,
    );
    const ds = computeOffsetDiagnostics(text);
    expect(ds).toHaveLength(1);
    expect(ds[0]?.code).toBe('dangling-reference');
    expect(ds[0]?.severity).toBe('error');
    expect(at(text, ds[0] as { start: number; length: number })).toBe('"ghost"');
  });

  it('points duplicate names at the second occurrence', () => {
    const text = JSON.stringify(
      { version: 1, devices: [{ name: 'x', role: 'router' }, { name: 'x' }] },
      null,
      2,
    );
    const ds = computeOffsetDiagnostics(text);
    expect(ds[0]?.code).toBe('duplicate-name');
    const hit = at(text, ds[0] as { start: number; length: number });
    expect(hit).toBe('"x"');
    expect(ds[0]?.start).toBeGreaterThan(text.indexOf('"router"')); // the SECOND x
  });

  it('marks missing-version at the opening brace, not the whole file', () => {
    const text = '{\n  "devices": []\n}\n';
    const ds = computeOffsetDiagnostics(text);
    expect(ds).toHaveLength(1);
    expect(ds[0]?.code).toBe('missing-version');
    expect(ds[0]?.severity).toBe('info');
    expect(ds[0]?.start).toBe(0);
    expect(ds[0]?.length).toBe(1);
  });

  it('falls back to the nearest existing ancestor for normalized-only paths', () => {
    // v3 top-level vrf: the canonical path logical_links[0].a.vrf does not
    // exist in the raw text — the diagnostic lands on the endpoint object
    const text = JSON.stringify(
      {
        version: 1,
        devices: [{ name: 'a' }, { name: 'b' }],
        logical_links: [{ vrf: 'GHOSTVRF', a: { device: 'a' }, b: { device: 'b' } }],
      },
      null,
      2,
    );
    const ds = computeOffsetDiagnostics(text);
    const undeclared = ds.filter((d) => d.code === 'undeclared-vrf');
    expect(undeclared).toHaveLength(2);
    for (const d of undeclared) {
      const hit = at(text, d as { start: number; length: number });
      expect(hit.startsWith('{')).toBe(true); // endpoint object, not offset 0
      expect(d.start).toBeGreaterThan(0);
    }
  });

  it("flags unknown fields on the raw text with a did-you-mean (the 'ip' agent mistake)", () => {
    const text = JSON.stringify(
      {
        version: 1,
        devices: [{ name: 'a' }],
        logical_links: [{ a: { device: 'a', ip: '10.0.0.1/30' }, b: { device: 'a' } }],
      },
      null,
      2,
    );
    const ds = computeOffsetDiagnostics(text);
    const unknown = ds.filter((d) => d.code === 'unknown-field');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.severity).toBe('warning');
    expect(unknown[0]?.message).toContain('did you mean "ip_address"?');
    expect(unknown[0]?.message).toContain('dropped');
    // the range covers the whole `"ip": "..."` property
    expect(at(text, unknown[0] as { start: number; length: number })).toBe('"ip": "10.0.0.1/30"');
  });

  it('covers warning-severity rules with ranges (unknown-interface, missing-lag-parent)', () => {
    const text = JSON.stringify(
      {
        version: 1,
        devices: [{ name: 'a', interfaces: [{ name: 'Gi1', lag: 'Po9' }] }],
        cables: [{ a: { device: 'a', interface: 'Gi99' }, b: { device: 'a' } }],
      },
      null,
      2,
    );
    const ds = computeOffsetDiagnostics(text);
    const byCode = Object.fromEntries(ds.map((d) => [d.code, d]));
    expect(at(text, byCode['missing-lag-parent'] as { start: number; length: number })).toBe('"Po9"');
    expect(at(text, byCode['unknown-interface'] as { start: number; length: number })).toBe('"Gi99"');
    expect(byCode['missing-lag-parent']?.severity).toBe('warning');
  });
});
