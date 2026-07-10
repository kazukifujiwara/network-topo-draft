import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyOutbound, toolResultToUpdate, wireBridge } from '../src/bridge';
import type { ToolResultSource } from '../src/bridge';

const HERE = dirname(fileURLToPath(import.meta.url));
const readFixture = (p: string): string =>
  readFileSync(resolve(HERE, '../../../fixtures', p), 'utf8');

/** Fake slice of the ext-apps App: capture the handler, emit on demand. */
function fakeApp(): ToolResultSource & {
  emit(structuredContent?: Record<string, unknown>): void;
} {
  const handlers: ((p: { structuredContent?: Record<string, unknown> }) => void)[] = [];
  return {
    addEventListener: (_event, handler) => void handlers.push(handler),
    emit: (structuredContent) => handlers.forEach((h) => h({ structuredContent })),
  };
}

describe('toolResultToUpdate (pure mapping)', () => {
  it('maps topology + view options; field names mirror the tool inputs', () => {
    const topology = { version: 1, devices: [{ name: 'a' }] };
    const r = toolResultToUpdate({ topology, view: 'logical', show_global: false, underlay: false });
    expect(JSON.parse(r.text)).toEqual(topology);
    expect(r.settings).toEqual({ view: 'logical', showGlobal: false, underlay: false });
  });

  it('defaults: physical view, global row on, underlay on', () => {
    const r = toolResultToUpdate({ topology: { version: 1, devices: [] } });
    expect(r.settings).toEqual({ view: 'physical', showGlobal: true, underlay: true });
  });

  it('throws a pointed error when the topology is missing', () => {
    expect(() => toolResultToUpdate(undefined)).toThrow(/structuredContent\.topology/);
    expect(() => toolResultToUpdate({ view: 'logical' })).toThrow(/no topology/);
  });
});

describe('classifyOutbound (phase-1 read-only policy)', () => {
  it('drops edits behind the phase-2 seam and startup chatter silently', () => {
    expect(classifyOutbound({ type: 'edit', text: '{}', baseVersion: 1 })).toBe('dropped-readonly');
    expect(classifyOutbound({ type: 'ready' })).toBe('ignored-lifecycle');
    expect(classifyOutbound({ type: 'list-templates' })).toBe('ignored-lifecycle');
    expect(classifyOutbound({ type: 'save-image', format: 'svg', text: '<svg/>' })).toBe(
      'dropped-unsupported',
    );
  });
});

describe('wireBridge (tool-result → rendered canvas, jsdom)', () => {
  const mount = (): HTMLElement => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    return root;
  };

  it('renders a fixture topology from a synthetic tool result', () => {
    const root = mount();
    const app = fakeApp();
    wireBridge(root, app);
    app.emit({ topology: JSON.parse(readFixture('v6v7/two-site-wan.topo.json')) });
    expect(root.querySelectorAll('[data-node]')).toHaveLength(6);
  });

  it('applies the logical view settings from the payload (VRF compartments appear)', () => {
    const root = mount();
    const app = fakeApp();
    wireBridge(root, app);
    app.emit({ topology: JSON.parse(readFixture('v3/wan-logical.topo.json')), view: 'logical' });
    expect(root.querySelectorAll('[data-vrfrow]').length).toBeGreaterThan(0);
    // a later physical render swaps the view back
    app.emit({ topology: JSON.parse(readFixture('v3/wan-logical.topo.json')), view: 'physical' });
    expect(root.querySelectorAll('[data-vrfrow]')).toHaveLength(0);
  });

  it('surfaces malformed structuredContent in the canvas error bar', () => {
    const root = mount();
    const app = fakeApp();
    wireBridge(root, app);
    app.emit({ nope: true } as Record<string, unknown>);
    const bar = root.querySelector('#errorBar') as HTMLElement;
    expect(bar.style.display).toBe('flex');
    expect(root.querySelector('#errorBar .em')?.textContent).toContain('no topology');
  });

  it('canvas edit attempts do not crash the read-only widget', () => {
    const root = mount();
    const app = fakeApp();
    wireBridge(root, app);
    app.emit({ topology: JSON.parse(readFixture('v1/canonical.topo.json')) });
    // simulate what a local canvas mutation would send outward
    expect(() =>
      classifyOutbound({ type: 'edit', text: '{"version":1,"devices":[]}', baseVersion: 1 }),
    ).not.toThrow();
  });
});
