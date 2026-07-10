/**
 * The build must emit ONE self-contained HTML document — the MCP Apps UI
 * resource contract (text/html;profile=mcp-app, no remote loads). The test
 * runs the real build so `npm test` catches regressions without a separate
 * build step.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('dist/app.html (#28)', () => {
  it('builds a single self-contained document', () => {
    execFileSync('node', [resolve(PKG, 'build.mjs')], { cwd: PKG });
    const html = readFileSync(resolve(PKG, 'dist/app.html'), 'utf8');
    expect(html).toContain('<div id="root"');
    expect(html).toContain('topodraftAppView'); // entry bundled in
    expect(html).toMatch(/<style>[\s\S]*#svg[\s\S]*<\/style>/); // CSS inlined
    // no remote references of any kind
    expect(html).not.toMatch(/\b(?:src|href)\s*=\s*["']https?:\/\//i);
    // sanity: nontrivial bundle (scene + core geometry)
    expect(html.length).toBeGreaterThan(50_000);
  });
});
