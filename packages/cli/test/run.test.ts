/**
 * CLI validation (headless agents' self-correction loop): the same
 * diagnostics as the editor's Problems panel, plus the JSON-syntax and
 * topology-shape layers the editor delegates to VSCode.
 */
import { describe, expect, it } from 'vitest';
import type { CliIo } from '../src/run';
import { formatHuman, runCli, validateText } from '../src/run';

const CLEAN = JSON.stringify(
  {
    version: 1,
    devices: [{ name: 'rt-01', vrfs: ['PROD'] }, { name: 'sw-01' }],
    cables: [{ a: { device: 'rt-01' }, b: { device: 'sw-01' } }],
  },
  null,
  2,
);

describe('validateText', () => {
  it('returns no diagnostics for a clean document', () => {
    expect(validateText(CLEAN)).toEqual([]);
  });

  it('reports JSON syntax errors with a position (the editor delegates these to VSCode)', () => {
    const diags = validateText('{\n  "version": 1,\n  oops\n}');
    expect(diags[0]?.code).toBe('invalid-json');
    expect(diags[0]?.severity).toBe('error');
    expect(diags[0]?.line).toBe(3);
  });

  it('reports topology-shape errors (parseable JSON, not a topology)', () => {
    const diags = validateText('{"version": 1, "devices": 3}');
    expect(diags).toHaveLength(1);
    expect(diags[0]?.code).toBe('invalid-topology');
  });

  it('reports the same semantic rules as the editor, with line/column', () => {
    const text = JSON.stringify(
      {
        version: 1,
        devices: [{ name: 'rt-01' }],
        cables: [{ a: { device: 'rt-01' }, b: { device: 'ghost' } }],
      },
      null,
      2,
    );
    const diags = validateText(text);
    expect(diags.map((d) => d.code)).toContain('dangling-reference');
    const dangling = diags.find((d) => d.code === 'dangling-reference');
    // the range points at the offending "ghost" reference
    const lines = text.split('\n');
    expect(lines[(dangling?.line ?? 1) - 1]).toContain('ghost');
  });

  it('reports unknown fields with did-you-mean suggestions', () => {
    const text = JSON.stringify(
      { version: 1, devices: [{ name: 'rt-01', interfaces: [{ name: 'Gi0/0/1', ip: 'x' }] }] },
      null,
      2,
    );
    const codes = validateText(text).map((d) => d.code);
    expect(codes).toContain('unknown-field');
    expect(validateText(text).some((d) => d.message.includes('ip_address'))).toBe(true);
  });
});

describe('formatHuman', () => {
  it('prints OK for a clean file and grep-friendly lines otherwise, errors first', () => {
    expect(formatHuman('a.topo.json', [])).toBe('a.topo.json: OK');
    const out = formatHuman('a.topo.json', [
      { severity: 'warning', code: 'w', message: 'later', line: 1, column: 1 },
      { severity: 'error', code: 'e', message: 'first', line: 9, column: 2 },
    ]);
    expect(out.split('\n')[0]).toBe('a.topo.json:9:2 error e first');
    expect(out.split('\n')[1]).toBe('a.topo.json:1:1 warning w later');
  });
});

function fakeIo(files: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    readFile: (path) => {
      if (!(path in files)) throw new Error('ENOENT');
      return files[path] as string;
    },
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
  };
  return { io, out, err };
}

describe('runCli', () => {
  const WARN_ONLY = JSON.stringify({
    version: 1,
    devices: [{ name: 'rt-01', interfaces: [{ name: 'Po1', lag: 'Po9' }] }],
  });

  it('validate: exit 0 with OK for clean files', () => {
    const { io, out } = fakeIo({ 'a.topo.json': CLEAN });
    expect(runCli(['validate', 'a.topo.json'], io, '1.0')).toBe(0);
    expect(out).toEqual(['a.topo.json: OK']);
  });

  it('validate: exit 1 when any file has errors; multiple files each reported', () => {
    const { io, out } = fakeIo({
      'a.topo.json': CLEAN,
      'b.topo.json': '{"version": 1, "devices": 3}',
    });
    expect(runCli(['validate', 'a.topo.json', 'b.topo.json'], io, '1.0')).toBe(1);
    expect(out[0]).toBe('a.topo.json: OK');
    expect(out[1]).toContain('invalid-topology');
  });

  it('warnings pass by default and fail with --strict', () => {
    const { io } = fakeIo({ 'w.topo.json': WARN_ONLY });
    expect(runCli(['validate', 'w.topo.json'], io, '1.0')).toBe(0);
    expect(runCli(['validate', '--strict', 'w.topo.json'], io, '1.0')).toBe(1);
  });

  it('--json emits machine-readable diagnostics for agents', () => {
    const { io, out } = fakeIo({ 'w.topo.json': WARN_ONLY });
    expect(runCli(['validate', '--json', 'w.topo.json'], io, '1.0')).toBe(0);
    const parsed = JSON.parse(out.join('\n')) as {
      results: { file: string; diagnostics: { code: string }[] }[];
    };
    expect(parsed.results[0]?.file).toBe('w.topo.json');
    expect(parsed.results[0]?.diagnostics.map((d) => d.code)).toContain('missing-lag-parent');
  });

  it('unreadable files and usage errors exit 2', () => {
    const { io, out } = fakeIo({});
    expect(runCli(['validate', 'missing.topo.json'], io, '1.0')).toBe(2);
    expect(out[0]).toContain('cannot read');
    const usage = fakeIo({});
    expect(runCli(['validate'], usage.io, '1.0')).toBe(2);
    expect(runCli(['frobnicate'], usage.io, '1.0')).toBe(2);
    expect(runCli(['validate', '--nope', 'a'], usage.io, '1.0')).toBe(2);
  });

  it('--help and --version exit 0', () => {
    const { io, out } = fakeIo({});
    expect(runCli(['--help'], io, '1.0')).toBe(0);
    expect(runCli(['--version'], io, '1.2.3')).toBe(0);
    expect(out).toContain('1.2.3');
  });
});
