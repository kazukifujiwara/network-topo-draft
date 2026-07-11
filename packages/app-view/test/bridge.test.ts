import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyOutbound, createLifecycle, toolResultToUpdate, wireBridge } from '../src/bridge';
import type { HostContextPatch, ToolResultSource } from '../src/bridge';

const HERE = dirname(fileURLToPath(import.meta.url));
const readFixture = (p: string): string =>
  readFileSync(resolve(HERE, '../../../fixtures', p), 'utf8');

/** Fake slice of the ext-apps App: capture handlers per event, emit on demand. */
function fakeApp(
  callServerTool?: ToolResultSource['callServerTool'],
): ToolResultSource & {
  emit(structuredContent?: Record<string, unknown>): void;
  emitToolInput(args: Record<string, unknown>): void;
  emitHostContext(patch: HostContextPatch): void;
} {
  const byEvent = new Map<string, ((p: never) => void)[]>();
  const fire = (event: string, params: unknown): void =>
    (byEvent.get(event) ?? []).forEach((h) => (h as (p: unknown) => void)(params));
  return {
    addEventListener: (event: string, handler: (p: never) => void) => {
      byEvent.set(event, [...(byEvent.get(event) ?? []), handler]);
    },
    callServerTool,
    onteardown: undefined,
    emit: (structuredContent) => fire('toolresult', { structuredContent }),
    emitToolInput: (args) => fire('toolinput', { arguments: args }),
    emitHostContext: (patch) => fire('hostcontextchanged', patch),
  };
}

/** Let the bridge's async tool-result handler settle. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

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

describe('host context lifecycle (#32)', () => {
  function fakeWindow(): Pick<Window, 'addEventListener' | 'removeEventListener'> & {
    listeners: Map<string, unknown[]>;
  } {
    const listeners = new Map<string, unknown[]>();
    return {
      listeners,
      addEventListener: ((type: string, l: unknown) =>
        listeners.set(type, [...(listeners.get(type) ?? []), l])) as Window['addEventListener'],
      removeEventListener: ((type: string, l: unknown) =>
        listeners.set(type, (listeners.get(type) ?? []).filter((x) => x !== l))) as Window['removeEventListener'],
    };
  }

  it('debounces resize bursts into ONE refit', async () => {
    let refits = 0;
    const win = fakeWindow();
    const lc = createLifecycle({ refit: () => void refits++ }, win);
    lc.handleResize();
    lc.handleResize();
    lc.handleResize();
    await new Promise((r) => setTimeout(r, 150));
    expect(refits).toBe(1);
    expect(win.listeners.get('resize')).toHaveLength(1); // registered on mount
  });

  it('display-mode changes refit; a pure theme change is deliberately ignored (dark palette stays)', async () => {
    let refits = 0;
    const lc = createLifecycle({ refit: () => void refits++ }, fakeWindow());
    lc.handleHostContext({ theme: 'light' }); // ignored — v0.4.0 palette decision
    await new Promise((r) => setTimeout(r, 150));
    expect(refits).toBe(0);
    lc.handleHostContext({ displayMode: 'fullscreen' });
    lc.handleHostContext({ theme: 'light', displayMode: 'pip' }); // mixed → layout change
    await new Promise((r) => setTimeout(r, 150));
    expect(refits).toBe(1); // still debounced
  });

  it('teardown clears the pending refit and unhooks the resize listener', async () => {
    let refits = 0;
    const win = fakeWindow();
    const lc = createLifecycle({ refit: () => void refits++ }, win);
    lc.handleResize();
    lc.teardown();
    await new Promise((r) => setTimeout(r, 150));
    expect(refits).toBe(0);
    expect(win.listeners.get('resize')).toHaveLength(0);
  });

  it('wireBridge installs the teardown hook on the App slot', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = fakeApp();
    wireBridge(root, app);
    expect(typeof app.onteardown).toBe('function');
    expect((app.onteardown as () => Record<string, never>)()).toEqual({});
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

  it('recovers via callServerTool when the host omits structuredContent (#42)', async () => {
    const topology = JSON.parse(readFixture('v6v7/two-site-wan.topo.json')) as Record<
      string,
      unknown
    >;
    const calls: { name: string; arguments?: Record<string, unknown> }[] = [];
    const app = fakeApp(async (params) => {
      calls.push(params);
      return { structuredContent: { topology, view: 'physical' } };
    });
    const root = mount();
    wireBridge(root, app);
    app.emitToolInput({ path: '/tmp/x.topo.json', view: 'physical' });
    app.emit(undefined); // the Claude Desktop 2025-11-25 behavior
    await tick();
    expect(calls).toEqual([
      { name: 'render_svg', arguments: { path: '/tmp/x.topo.json', view: 'physical' } },
    ]);
    expect(root.querySelectorAll('[data-node]')).toHaveLength(6);
  });

  it('spec-compliant results never trigger the recovery call (#42)', async () => {
    const calls: unknown[] = [];
    const app = fakeApp(async (params) => {
      calls.push(params);
      return {};
    });
    const root = mount();
    wireBridge(root, app);
    app.emitToolInput({ path: 'x.topo.json' });
    app.emit({ topology: JSON.parse(readFixture('v1/canonical.topo.json')) });
    await tick();
    expect(calls).toHaveLength(0);
    expect(root.querySelectorAll('[data-node]').length).toBeGreaterThan(0);
  });

  it('falls back to the error surface when recovery is impossible (#42)', async () => {
    // no tool-input seen → nothing to recover with
    const root1 = mount();
    const app1 = fakeApp(async () => ({}));
    wireBridge(root1, app1);
    app1.emit(undefined);
    await tick();
    expect((root1.querySelector('#errorBar') as HTMLElement).style.display).toBe('flex');

    // recovery answered, but still without a topology
    const root2 = mount();
    const app2 = fakeApp(async () => ({ structuredContent: { nope: true } }));
    wireBridge(root2, app2);
    app2.emitToolInput({ path: 'x.topo.json' });
    app2.emit(undefined);
    await tick();
    expect((root2.querySelector('#errorBar') as HTMLElement).style.display).toBe('flex');
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
