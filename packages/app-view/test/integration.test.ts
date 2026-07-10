/**
 * Milestone-level test surface (#33), on top of the per-issue units:
 *
 * 1. Fixture sweep — every repo fixture renders in the widget, in BOTH
 *    views, with node/link counts derived from @topodraft/core itself
 *    (buildNodes/buildLinks are the same code the canvas draws from, so
 *    the expectation cannot drift from the implementation).
 * 2. Contract loop — the REAL server's structuredContent (created by
 *    packages/mcp createServer, fetched over the SDK's in-memory
 *    transport by a ui-capable client) drives the REAL bridge into a
 *    rendered scene. This closes the #29 ⇄ #30 payload contract that the
 *    per-package tests each only exercised half of.
 * 3. Error surface — a topology that is JSON but not a valid topology
 *    lands in the canvas's D11 error bar instead of a blank widget.
 * 4. Stability — same-view updates must NOT rebuild the canvas (pan/zoom
 *    state of the running app survives consecutive renders).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Topology, ViewMode } from '@topodraft/core';
import { buildLinks, buildNodes, displayTopology, parse, toCanonical } from '@topodraft/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../mcp/src/server';
import { toolResultToUpdate, wireBridge } from '../src/bridge';
import type { ToolResultSource } from '../src/bridge';
import { mountAppView } from '../src/mount';

const HERE = dirname(fileURLToPath(import.meta.url));
const readFixture = (p: string): string =>
  readFileSync(resolve(HERE, '../../../fixtures', p), 'utf8');

const FIXTURES = [
  'v1/canonical.topo.json',
  'v1/minimal.topo.json',
  'v1/vrrp-segment.topo.json',
  'v3/wan-logical.topo.json',
  'v4v5/dx-endpoint-ip.topo.json',
  'v6v7/site-cloud.topo.json',
  'v6v7/two-site-wan.topo.json',
];

const mount = (): HTMLElement => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
};

/** Expected drawn-link count, mirroring the scene's view filter. */
function expectedLinks(t: Topology, view: ViewMode): number {
  const shown = displayTopology(t);
  const nodes = buildNodes(shown, { viewMode: view, showGlobal: true });
  return buildLinks(shown).filter((l) => {
    if (view === 'physical' && l.kind === 'logical') return false; // logical hidden
    // logical view keeps everything (underlay on — the widget default)
    return (
      l.aName !== undefined &&
      l.bName !== undefined &&
      nodes.has(l.aName) &&
      nodes.has(l.bName)
    );
  }).length;
}

describe('fixture sweep (#33): every fixture renders in both views, counts from core', () => {
  for (const fixture of FIXTURES) {
    for (const view of ['physical', 'logical'] as const) {
      it(`${fixture} — ${view}`, () => {
        const t = parse(readFixture(fixture));
        const payload = { topology: toCanonical(t) as unknown as Record<string, unknown>, view };
        const { text, settings } = toolResultToUpdate(payload);
        const root = mount();
        const widget = mountAppView(root);
        widget.update(text, settings);
        const nodes = buildNodes(displayTopology(t), { viewMode: view, showGlobal: true });
        expect(root.querySelectorAll('[data-node]')).toHaveLength(nodes.size);
        expect(root.querySelectorAll('[data-link]')).toHaveLength(expectedLinks(t, view));
        expect(root.querySelector('#errorBar')?.getAttribute('style') ?? '').not.toContain(
          'display: flex',
        );
      });
    }
  }
});

describe('server ⇄ widget contract loop (#33)', () => {
  const FAKE_HTML = '<!DOCTYPE html><html><body><div id="root"></div></body></html>';
  let client: Client;

  beforeAll(async () => {
    const server = createServer(
      {
        readFile: (path) => {
          if (path !== 'site-cloud.topo.json') throw new Error(`ENOENT: ${path}`);
          return readFixture('v6v7/site-cloud.topo.json');
        },
        writeFile: () => {},
      },
      '0.0.0-test',
      { appHtml: FAKE_HTML },
    );
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    client = new Client(
      { name: 'integration-client', version: '0.0.0' },
      { capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } } },
    );
    await client.connect(ct);
  });

  it('the real render_svg structuredContent drives the real bridge into a scene', async () => {
    const result = await client.callTool({
      name: 'render_svg',
      arguments: { path: 'site-cloud.topo.json', view: 'logical', show_global: false },
    });
    expect(result.isError).toBeFalsy();

    const root = mount();
    const handlers: ((p: { structuredContent?: Record<string, unknown> }) => void)[] = [];
    const source: ToolResultSource = {
      addEventListener: (event: string, handler: unknown) => {
        if (event === 'toolresult') {
          handlers.push(handler as (p: { structuredContent?: Record<string, unknown> }) => void);
        }
      },
      onteardown: undefined,
    } as unknown as ToolResultSource;
    wireBridge(root, source);
    handlers.forEach((h) =>
      h({ structuredContent: result.structuredContent as Record<string, unknown> }),
    );

    // the scene matches what core derives from the same fixture
    const t = parse(readFixture('v6v7/site-cloud.topo.json'));
    const nodes = buildNodes(displayTopology(t), { viewMode: 'logical', showGlobal: false });
    expect(root.querySelectorAll('[data-node]')).toHaveLength(nodes.size);
    // show_global=false traveled the whole loop: no 'global' compartment rows
    const rowLabels = [...root.querySelectorAll('.vrf-row-label')].map((l) => l.textContent);
    expect(rowLabels.length).toBeGreaterThan(0);
    expect(rowLabels).not.toContain('global');
  });
});

describe('error surface & stability (#33)', () => {
  it('a JSON-valid but invalid topology lands in the D11 error bar', () => {
    const root = mount();
    const widget = mountAppView(root);
    const bad = toolResultToUpdate({
      topology: { version: 1, devices: {} } as unknown as Record<string, unknown>,
    });
    widget.update(bad.text, bad.settings);
    expect((root.querySelector('#errorBar') as HTMLElement).style.display).toBe('flex');
  });

  it('same-view updates do NOT rebuild the canvas (app element identity survives)', () => {
    const root = mount();
    const widget = mountAppView(root);
    const payload = (name: string) =>
      toolResultToUpdate({
        topology: { version: 1, devices: [{ name }] } as unknown as Record<string, unknown>,
        view: 'physical',
      });
    const p1 = payload('a');
    widget.update(p1.text, p1.settings);
    const appEl = root.querySelector('#app');
    const p2 = payload('b');
    widget.update(p2.text, p2.settings);
    expect(root.querySelector('#app')).toBe(appEl); // same instance
    const p3 = toolResultToUpdate({
      topology: { version: 1, devices: [{ name: 'b' }] } as unknown as Record<string, unknown>,
      view: 'logical',
    });
    widget.update(p3.text, p3.settings);
    expect(root.querySelector('#app')).not.toBe(appEl); // view switch rebuilds
  });
});
