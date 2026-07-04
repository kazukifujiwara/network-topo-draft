/**
 * Phase 2 editing behavior (plan §6.2 ⑥ + ⑤ webview side): canvas edits
 * serialize into edit requests at v7's pushHistory moments, rename follows
 * references, the sync loop suppresses echoes and survives agent races, and
 * editing is paused while the document is invalid (D11).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Topology } from '@topodraft/core';
import type { EditMessage } from '@topodraft/protocol';
import { createApp } from '../src/app';
import type { App } from '../src/app';
import { fakeHost, mount } from './helpers';
import type { FakeHost } from './helpers';

const FIXED_VIEW = {
  vt: { x: 0, y: 0, k: 1 },
  viewMode: 'physical' as const,
  underlayOn: true,
  showGlobal: true,
  gridOn: true,
  snapOn: true,
};

const TOPO = {
  version: 1,
  devices: [
    {
      name: 'rt-1',
      role: 'router',
      site: 'HQ',
      vrfs: ['PROD'],
      interfaces: [{ name: 'Gi0' }],
      position: { x: 100, y: 100 },
    },
    { name: 'rt-2', role: 'router', site: 'DC', position: { x: 400, y: 100 } },
    { name: 'sw-1', role: 'switch', site: 'HQ', position: { x: 100, y: 300 } },
  ],
  provider_networks: [{ name: 'DX', position: { x: 400, y: 300 } }],
  cables: [{ a: { device: 'rt-1' }, b: { device: 'sw-1' }, type: 'cat6' }],
  logical_links: [{ a: { device: 'rt-1', vrf: 'PROD' }, b: { device: 'rt-2' } }],
};

interface Harness {
  f: FakeHost;
  root: HTMLElement;
  app: App;
  /** last edit message posted to the host */
  lastEdit(): EditMessage | undefined;
  /** parsed text of the last edit */
  lastTopo(): Topology;
  /** acknowledge the last edit like the host would (self-originated echo) */
  ack(): void;
  editCount(): number;
}

let version = 1;

function harness(topo: unknown = TOPO): Harness {
  version = 1;
  const f = fakeHost(FIXED_VIEW);
  const root = mount();
  const app = createApp(root, f.host);
  app.handleMessage({
    type: 'update',
    text: JSON.stringify(topo),
    docVersion: version,
    selfOriginated: false,
  });
  const lastEdit = (): EditMessage | undefined =>
    [...f.posted].reverse().find((m): m is EditMessage => m.type === 'edit');
  return {
    f,
    root,
    app,
    lastEdit,
    lastTopo: () => JSON.parse(lastEdit()?.text ?? 'null') as Topology,
    ack: () => {
      const e = lastEdit();
      if (!e) throw new Error('nothing to ack');
      version++;
      app.handleMessage({ type: 'update', text: e.text, docVersion: version, selfOriginated: true });
    },
    editCount: () => f.posted.filter((m) => m.type === 'edit').length,
  };
}

const mouse = (el: Element | Window, type: string, opts: MouseEventInit = {}): void => {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...opts }));
};
const key = (k: string, opts: KeyboardEventInit = {}): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));
};
const setInput = (root: HTMLElement, sel: string, value: string): HTMLInputElement => {
  const inp = root.querySelector(sel) as HTMLInputElement;
  inp.value = value;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return inp;
};
const nodeEl = (root: HTMLElement, name: string): Element =>
  root.querySelector(`[data-node="${name}"]`) as Element;

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('selection', () => {
  it('click selects a node and shows its panel; shift-click extends; Esc clears', () => {
    const h = harness();
    mouse(nodeEl(h.root, 'rt-1'), 'mousedown');
    mouse(window, 'mouseup');
    expect([...h.app.getSelection().nodes]).toEqual(['rt-1']);
    expect(nodeEl(h.root, 'rt-1').classList.contains('selected')).toBe(true);
    expect(h.root.querySelector('#panel input[data-f="name"]')).toHaveProperty('value', 'rt-1');

    mouse(nodeEl(h.root, 'rt-2'), 'mousedown', { shiftKey: true });
    mouse(window, 'mouseup');
    expect(h.app.getSelection().nodes.size).toBe(2);

    key('Escape');
    expect(h.app.getSelection().nodes.size).toBe(0);
  });

  it('Ctrl+A selects all nodes including provider networks', () => {
    const h = harness();
    key('a', { ctrlKey: true });
    expect(h.app.getSelection().nodes.size).toBe(4);
  });

  it('shift-drag marquee adds every intersecting node', () => {
    const h = harness();
    mouse(h.app.dom.svg, 'mousedown', { shiftKey: true, clientX: 50, clientY: 50 });
    mouse(window, 'mousemove', { clientX: 300, clientY: 400 });
    mouse(window, 'mouseup', { clientX: 300, clientY: 400 });
    // rt-1 (100,100) and sw-1 (100,300) intersect; rt-2/DX (x=400) do not
    expect([...h.app.getSelection().nodes].sort()).toEqual(['rt-1', 'sw-1']);
  });

  it('clicking a link selects it and opens its panel', () => {
    const h = harness();
    mouse(h.root.querySelector('[data-link="cables:0"] .link-hit') as Element, 'mousedown');
    expect(h.app.getSelection().link).toEqual({ col: 'cables', idx: 0 });
    expect(h.root.querySelector('#panel .pn-title')?.textContent).toContain('Physical link');
  });
});

describe('node drag → one edit on mouseup (plan §4.2-5)', () => {
  it('commits snapped positions for the whole selection once', () => {
    const h = harness();
    mouse(nodeEl(h.root, 'rt-1'), 'mousedown', { clientX: 110, clientY: 110 });
    mouse(window, 'mousemove', { clientX: 161, clientY: 135 });
    mouse(window, 'mousemove', { clientX: 163, clientY: 137 });
    expect(h.editCount()).toBe(0); // nothing sent while dragging
    mouse(window, 'mouseup', { clientX: 163, clientY: 137 });
    expect(h.editCount()).toBe(1);
    const edit = h.lastEdit() as EditMessage;
    expect(edit.baseVersion).toBe(1);
    const moved = h.lastTopo().devices.find((d) => d.name === 'rt-1');
    expect(moved?.position).toEqual({ x: 150, y: 130 }); // snapped to the 10px grid
  });

  it('a click without movement commits nothing', () => {
    const h = harness();
    mouse(nodeEl(h.root, 'rt-1'), 'mousedown', { clientX: 110, clientY: 110 });
    mouse(window, 'mouseup', { clientX: 110, clientY: 110 });
    expect(h.editCount()).toBe(0);
  });

  it('dragging in an auto-laid-out file materializes ALL positions in the commit', () => {
    const h = harness({ version: 1, devices: [{ name: 'a' }, { name: 'b' }] });
    mouse(nodeEl(h.root, 'a'), 'mousedown', { clientX: 50, clientY: 50 });
    mouse(window, 'mousemove', { clientX: 90, clientY: 90 });
    mouse(window, 'mouseup', { clientX: 90, clientY: 90 });
    const t = h.lastTopo();
    expect(t.devices.every((d) => d.position !== undefined)).toBe(true);
  });
});

describe('arrow-key nudges collapse into one edit (400ms debounce)', () => {
  it('sends a single edit after the debounce', () => {
    vi.useFakeTimers();
    const h = harness();
    mouse(nodeEl(h.root, 'rt-1'), 'mousedown', { clientX: 110, clientY: 110 });
    mouse(window, 'mouseup', { clientX: 110, clientY: 110 });
    key('ArrowRight');
    key('ArrowRight');
    key('ArrowDown', { altKey: true }); // Alt = 1px
    expect(h.editCount()).toBe(0);
    vi.advanceTimersByTime(400);
    expect(h.editCount()).toBe(1);
    const moved = h.lastTopo().devices.find((d) => d.name === 'rt-1');
    expect(moved?.position).toEqual({ x: 120, y: 101 });
  });
});

describe('rename with reference-following (ADR D10)', () => {
  it('panel name change rewrites every link endpoint and keeps the node selected', () => {
    const h = harness();
    h.app.api.selectOnly('rt-1');
    setInput(h.root, '#panel input[data-f="name"]', 'core-1');
    const t = h.lastTopo();
    expect(t.devices[0]?.name).toBe('core-1');
    expect(t.cables?.[0]?.a.device).toBe('core-1');
    expect(t.logical_links?.[0]?.a.device).toBe('core-1');
    expect([...h.app.getSelection().nodes]).toEqual(['core-1']);
  });

  it('provider-network rename follows circuit/logical references', () => {
    const h = harness({
      ...TOPO,
      circuits: [{ a: { device: 'rt-1' }, b: { provider_network: 'DX' } }],
    });
    h.app.api.selectOnly('DX');
    setInput(h.root, '#panel input[data-f="name"]', 'AWS-DX');
    const t = h.lastTopo();
    expect(t.provider_networks?.[0]?.name).toBe('AWS-DX');
    expect(t.circuits?.[0]?.b.provider_network).toBe('AWS-DX');
  });
});

describe('panel edits (v7 granularity: input mutates, change commits)', () => {
  it('device field: input alone does not commit, change does', () => {
    const h = harness();
    h.app.api.selectOnly('rt-1');
    const inp = h.root.querySelector('#panel input[data-f="tenant"]') as HTMLInputElement;
    inp.value = 'NetOps';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    expect(h.editCount()).toBe(0);
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.editCount()).toBe(1);
    expect(h.lastTopo().devices[0]?.tenant).toBe('NetOps');
  });

  it('VRF add/remove commits and re-renders the chips', () => {
    const h = harness();
    h.app.api.selectOnly('rt-1');
    (h.root.querySelector('#vrfNew') as HTMLInputElement).value = 'DEV';
    (h.root.querySelector('#vrfAdd') as HTMLElement).click();
    expect(h.lastTopo().devices[0]?.vrfs).toEqual(['PROD', 'DEV']);
    h.ack();
    (h.root.querySelector('[data-vdel="DEV"]') as HTMLElement).click();
    expect(h.lastTopo().devices[0]?.vrfs).toEqual(['PROD']);
  });

  it('a new interface persists once it has content', () => {
    const h = harness();
    h.app.api.selectOnly('rt-1');
    (h.root.querySelector('#ifAdd') as HTMLElement).click();
    expect(h.editCount()).toBe(0); // empty interface cannot exist in the file
    setInput(h.root, '#panel input[data-if="1"][data-k="name"]', 'Gi1');
    expect(h.lastTopo().devices[0]?.interfaces).toEqual([{ name: 'Gi0' }, { name: 'Gi1' }]);
  });

  it('logical endpoint IP writes through to the device interface (core semantics)', () => {
    const h = harness();
    h.app.api.selectLink({ col: 'logical_links', idx: 0 });
    setInput(h.root, '#panel input[data-epi="a"]', 'Gi0.100');
    h.ack();
    setInput(h.root, '#panel input[data-epip="a"]', '169.254.0.1/30');
    const t = h.lastTopo();
    expect(t.devices[0]?.interfaces).toEqual([
      { name: 'Gi0' },
      { name: 'Gi0.100', ip_address: '169.254.0.1/30', vrf: 'PROD' },
    ]);
    expect(t.logical_links?.[0]?.a.ip_address).toBeUndefined();
  });

  it('cable → circuit conversion via the panel segment keeps shared fields', () => {
    const h = harness();
    h.app.api.selectLink({ col: 'cables', idx: 0 });
    (h.root.querySelector('#segCircuit') as HTMLElement).click();
    const t = h.lastTopo();
    expect(t.cables).toBeUndefined();
    expect(t.circuits?.[0]).toEqual({ a: { site: 'HQ', device: 'rt-1' }, b: { site: 'HQ', device: 'sw-1' }, type: 'cat6' });
    expect(h.app.getSelection().link).toEqual({ col: 'circuits', idx: 0 });
  });
});

describe('link creation by port drag (v7 kind rules)', () => {
  const dragPort = (h: Harness, fromPortSel: string, toEl: Element): void => {
    mouse(h.root.querySelector(fromPortSel) as Element, 'mousedown');
    mouse(toEl, 'mousemove');
    mouse(toEl, 'mouseup');
  };

  it('same-site devices connect as a cable', () => {
    const h = harness();
    h.app.api.selectOnly('rt-1'); // single selection shows ports
    dragPort(h, '[data-port="rt-1"]', nodeEl(h.root, 'sw-1'));
    const t = h.lastTopo();
    expect(t.cables).toHaveLength(2);
    expect(t.cables?.[1]).toEqual({ a: { device: 'rt-1' }, b: { device: 'sw-1' } });
  });

  it('cross-site devices connect as a circuit', () => {
    const h = harness();
    h.app.api.selectOnly('rt-1');
    dragPort(h, '[data-port="rt-1"]', nodeEl(h.root, 'rt-2'));
    const t = h.lastTopo();
    expect(t.circuits?.[0]).toEqual({
      a: { site: 'HQ', device: 'rt-1' },
      b: { site: 'DC', device: 'rt-2' },
    });
  });

  it('links to a provider network are always circuits', () => {
    const h = harness();
    h.app.api.selectOnly('sw-1');
    dragPort(h, '[data-port="sw-1"]', nodeEl(h.root, 'DX'));
    expect(h.lastTopo().circuits?.[0]?.b).toEqual({ provider_network: 'DX' });
  });

  it('compartment-to-compartment drags create logical links with both VRFs', () => {
    const h = harness();
    (h.root.querySelector('#btnLogi') as HTMLElement).click();
    h.app.api.selectOnly('rt-1');
    const fromPort = h.root.querySelector('[data-vrfport="rt-1"][data-vrfname="PROD"]') as Element;
    mouse(fromPort, 'mousedown');
    mouse(h.root.querySelector('[data-vrfrow="rt-2"][data-vrfname=""]') as Element, 'mousemove');
    // the hover render rebuilds the SVG — re-query the drop row like a real
    // pointer would hit the live element
    mouse(h.root.querySelector('[data-vrfrow="rt-2"][data-vrfname=""]') as Element, 'mouseup');
    const t = h.lastTopo();
    expect(t.logical_links).toHaveLength(2);
    expect(t.logical_links?.[1]).toEqual({ a: { device: 'rt-1', vrf: 'PROD' }, b: { device: 'rt-2' } });
    expect(h.app.getSelection().link).toEqual({ col: 'logical_links', idx: 1 });
  });
});

describe('context menu', () => {
  it('converts a cable to a circuit', () => {
    const h = harness();
    const linkEl = h.root.querySelector('[data-link="cables:0"]') as Element;
    linkEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    const item = [...h.root.querySelectorAll('#ctxMenu .ci')].find(
      (el) => el.textContent === 'Change to circuit',
    ) as HTMLElement;
    item.click();
    expect(h.lastTopo().cables).toBeUndefined();
    expect(h.lastTopo().circuits).toHaveLength(1);
  });

  it('adds a node at the click position from the canvas menu', () => {
    const h = harness();
    h.app.dom.svg.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 500, clientY: 500 }),
    );
    const item = [...h.root.querySelectorAll('#ctxMenu .ci')].find(
      (el) => el.textContent === 'Firewall',
    ) as HTMLElement;
    item.click();
    const t = h.lastTopo();
    const fw = t.devices.find((d) => d.role === 'firewall');
    expect(fw?.name).toBe('fw-01');
    expect(fw?.position).toEqual({ x: 420, y: 470 }); // centered on the cursor, snapped
    expect([...h.app.getSelection().nodes]).toEqual(['fw-01']);
  });

  it('changes a device role from the icon row', () => {
    const h = harness();
    nodeEl(h.root, 'sw-1').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    const roleBtn = h.root.querySelector('#ctxMenu .roles button[title="Firewall"]') as HTMLElement;
    roleBtn.click();
    expect(h.lastTopo().devices.find((d) => d.name === 'sw-1')?.role).toBe('firewall');
  });
});

describe('clipboard: copy / paste / duplicate', () => {
  it('Ctrl+C / Ctrl+V pastes with unique names and remapped internal links', () => {
    const h = harness();
    h.app.api.setSelection(['rt-1', 'sw-1']);
    key('c', { ctrlKey: true });
    expect(h.editCount()).toBe(0); // copy is webview-local
    key('v', { ctrlKey: true });
    const t = h.lastTopo();
    expect(t.devices.map((d) => d.name)).toEqual(['rt-1', 'rt-2', 'sw-1', 'rt-1-2', 'sw-1-2']);
    expect(t.cables?.[1]).toMatchObject({ a: { device: 'rt-1-2' }, b: { device: 'sw-1-2' } });
    expect([...h.app.getSelection().nodes].sort()).toEqual(['rt-1-2', 'sw-1-2']);
  });

  it('Ctrl+D duplicates without touching the stored clipboard', () => {
    const h = harness();
    h.app.api.setSelection(['rt-2']);
    key('c', { ctrlKey: true });
    h.app.api.setSelection(['sw-1']);
    key('d', { ctrlKey: true });
    expect(h.lastTopo().devices.map((d) => d.name)).toContain('sw-1-2');
    h.ack();
    key('v', { ctrlKey: true }); // clipboard still holds rt-2
    expect(h.lastTopo().devices.map((d) => d.name)).toContain('rt-2-2');
  });
});

describe('delete', () => {
  it('Delete removes selected nodes and their attached links', () => {
    const h = harness();
    h.app.api.selectOnly('rt-1');
    key('Delete');
    const t = h.lastTopo();
    expect(t.devices.map((d) => d.name)).toEqual(['rt-2', 'sw-1']);
    expect(t.cables).toBeUndefined();
    expect(t.logical_links).toBeUndefined();
  });

  it('Delete removes a selected link only', () => {
    const h = harness();
    h.app.api.selectLink({ col: 'cables', idx: 0 });
    key('Backspace');
    const t = h.lastTopo();
    expect(t.cables).toBeUndefined();
    expect(t.devices).toHaveLength(3);
  });
});

describe('config context modal (JSON only, ADR D2)', () => {
  it('saves a valid object and commits', () => {
    const h = harness();
    h.app.api.openConfigContext('rt-1');
    const text = h.root.querySelector('#modalText') as HTMLTextAreaElement;
    text.value = '{"bgp": {"asn": 65010}}';
    (h.root.querySelector('#modalSave') as HTMLElement).click();
    expect(h.lastTopo().devices[0]?.config_context).toEqual({ bgp: { asn: 65010 } });
  });

  it('rejects non-object top levels without committing', () => {
    const h = harness();
    h.app.api.openConfigContext('rt-1');
    (h.root.querySelector('#modalText') as HTMLTextAreaElement).value = '[1, 2]';
    (h.root.querySelector('#modalSave') as HTMLElement).click();
    expect(h.editCount()).toBe(0);
    expect(h.root.querySelector('#modalNote')?.textContent).toContain('must be an object');
  });
});

describe('sync loop (webview side of plan §4.2)', () => {
  it('self-originated echo is suppressed and advances the base version', () => {
    const h = harness();
    h.app.api.selectOnly('rt-1');
    setInput(h.root, '#panel input[data-f="tenant"]', 'NetOps');
    expect(h.lastEdit()?.baseVersion).toBe(1);
    h.ack(); // docVersion 2
    expect(h.app.getDocState().docVersion).toBe(2);
    expect([...h.app.getSelection().nodes]).toEqual(['rt-1']); // selection survives the echo
    setInput(h.root, '#panel input[data-f="platform"]', 'IOS-XE');
    expect(h.lastEdit()?.baseVersion).toBe(2);
  });

  it('edits made while an ack is pending are queued into ONE follow-up edit', () => {
    const h = harness();
    h.app.api.selectOnly('rt-1');
    setInput(h.root, '#panel input[data-f="tenant"]', 'NetOps');
    setInput(h.root, '#panel input[data-f="platform"]', 'IOS-XE');
    expect(h.editCount()).toBe(1); // second commit queued behind the ack
    h.ack();
    expect(h.editCount()).toBe(2);
    const t = h.lastTopo();
    expect(t.devices[0]?.tenant).toBe('NetOps');
    expect(t.devices[0]?.platform).toBe('IOS-XE');
  });

  it('an external (agent) update wins over pending local state and prunes selection', () => {
    const h = harness();
    h.app.api.selectOnly('rt-1');
    setInput(h.root, '#panel input[data-f="tenant"]', 'NetOps'); // pending, never acked
    version++;
    h.app.handleMessage({
      type: 'update',
      text: JSON.stringify({ version: 1, devices: [{ name: 'agent-only' }] }),
      docVersion: version,
      selfOriginated: false,
    });
    expect(h.app.getSelection().nodes.size).toBe(0);
    expect(h.root.querySelectorAll('[data-node]')).toHaveLength(1);
    // editing continues against the new state
    h.app.api.selectOnly('agent-only');
    setInput(h.root, '#panel input[data-f="role"]', 'router');
    expect(h.lastEdit()?.baseVersion).toBe(version);
  });

  it('editing is paused while the document is invalid (D11: never write back)', () => {
    const h = harness();
    version++;
    h.app.handleMessage({
      type: 'update',
      text: '{ mid-edit garbage',
      docVersion: version,
      selfOriginated: false,
    });
    key('a', { ctrlKey: true });
    key('Delete');
    mouse(nodeEl(h.root, 'rt-1'), 'mousedown', { clientX: 110, clientY: 110 });
    mouse(window, 'mousemove', { clientX: 200, clientY: 200 });
    mouse(window, 'mouseup', { clientX: 200, clientY: 200 });
    expect(h.editCount()).toBe(0);
    expect(h.root.querySelector('#panel')?.textContent).toContain('editing is paused');
    // recovery restores editing
    version++;
    h.app.handleMessage({
      type: 'update',
      text: JSON.stringify(TOPO),
      docVersion: version,
      selfOriginated: false,
    });
    h.app.api.selectOnly('rt-1');
    setInput(h.root, '#panel input[data-f="tenant"]', 'ok');
    expect(h.editCount()).toBe(1);
  });

  it('Ctrl+Z is left for VSCode: the webview never handles or blocks it (D6/D14)', () => {
    const h = harness();
    h.app.api.selectOnly('rt-1');
    const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(h.editCount()).toBe(0);
  });
});

describe('toolbar export menu (v7 Export button)', () => {
  it('posts an export request for the picked format and closes the menu', () => {
    const h = harness();
    const menu = h.root.querySelector('#exportMenu') as HTMLElement;
    expect(menu.style.display).not.toBe('block');
    (h.root.querySelector('#btnExport') as HTMLElement).click();
    expect(menu.style.display).toBe('block');
    (h.root.querySelector('[data-export="markdown"]') as HTMLElement).click();
    expect(h.f.posted).toContainEqual({ type: 'export', kind: 'markdown' });
    expect(menu.style.display).toBe('none');
    (h.root.querySelector('#btnExport') as HTMLElement).click();
    (h.root.querySelector('[data-export="drawio"]') as HTMLElement).click();
    expect(h.f.posted).toContainEqual({ type: 'export', kind: 'drawio' });
  });
});

describe('multi-access network segments (spec §3.10)', () => {
  const SEG_TOPO = {
    version: 1,
    devices: [
      {
        name: 'rt-1',
        role: 'router',
        vrfs: ['PROD'],
        interfaces: [{ name: 'Gi0.100', ip_address: '10.0.0.2/28', vrf: 'PROD' }],
        position: { x: 100, y: 100 },
      },
    ],
    networks: [
      {
        name: 'seg-1',
        prefix: '10.0.0.0/28',
        vlan: '100',
        fhrp: { protocol: 'hsrp', group: '1', virtual_ip: '10.0.0.1/28' },
        position: { x: 500, y: 100 },
      },
    ],
  };

  it('renders segments in the logical view only, with prefix and VIP labels', () => {
    const h = harness(SEG_TOPO);
    expect(h.root.querySelector('[data-node="seg-1"]')).toBeNull(); // physical view
    (h.root.querySelector('#btnLogi') as HTMLElement).click();
    const node = h.root.querySelector('[data-node="seg-1"]') as Element;
    expect(node).not.toBeNull();
    expect(node.querySelector('.node-box')?.classList.contains('netbox')).toBe(true);
    expect(node.textContent).toContain('10.0.0.0/28 · vlan 100');
    expect(node.textContent).toContain('VIP 10.0.0.1/28 (hsrp 1)');
  });

  it('REGRESSION: attachment links to a segment are drawn in the logical view', () => {
    const h = harness({
      ...SEG_TOPO,
      logical_links: [{ a: { device: 'rt-1', vrf: 'PROD' }, b: { network: 'seg-1' } }],
    });
    expect(h.root.querySelectorAll('.link')).toHaveLength(0); // physical view: hidden
    (h.root.querySelector('#btnLogi') as HTMLElement).click();
    const links = h.root.querySelectorAll('#lyLogi .link');
    expect(links).toHaveLength(1); // was skipped as dangling before the fix
    expect(links[0]?.querySelector('.link-line.logical')).not.toBeNull();
  });

  it('REGRESSION: attachment endpoints land ON the pill boundary, not the square corner', () => {
    const h = harness({
      version: 1,
      devices: [{ name: 'rt-1', position: { x: 0, y: 120 } }],
      networks: [{ name: 'seg-1', position: { x: 400, y: 0 } }],
      logical_links: [{ a: { device: 'rt-1' }, b: { network: 'seg-1' } }],
    });
    (h.root.querySelector('#btnLogi') as HTMLElement).click();
    const dots = h.root.querySelectorAll('#lyLogi .link circle');
    expect(dots).toHaveLength(2);
    const seg = dots[1] as Element; // b side = the segment end
    const px = Number(seg.getAttribute('cx'));
    const py = Number(seg.getAttribute('cy'));
    // pill boundary equation: max(|dx|-ix,0)² + max(|dy|-iy,0)² = r²
    const ex = Math.max(Math.abs(px - (400 + 76)) - (76 - 24), 0);
    const ey = Math.max(Math.abs(py - 26) - (26 - 24), 0);
    expect(ex * ex + ey * ey).toBeCloseTo(24 * 24, 3);
  });

  it('dragging from a VRF compartment onto a segment attaches with a {network} endpoint', () => {
    const h = harness(SEG_TOPO);
    (h.root.querySelector('#btnLogi') as HTMLElement).click();
    h.app.api.selectOnly('rt-1');
    mouse(h.root.querySelector('[data-vrfport="rt-1"][data-vrfname="PROD"]') as Element, 'mousedown');
    mouse(h.root.querySelector('[data-node="seg-1"]') as Element, 'mousemove');
    mouse(h.root.querySelector('[data-node="seg-1"]') as Element, 'mouseup');
    const t = h.lastTopo();
    expect(t.logical_links?.[0]).toEqual({
      a: { device: 'rt-1', vrf: 'PROD' },
      b: { network: 'seg-1' },
    });
  });

  it('adding a segment from the palette switches to the logical view', () => {
    const h = harness(SEG_TOPO); // starts in physical view
    mouse(h.root.querySelector('[data-pal-role="__network__"]') as Element, 'mousedown');
    mouse(h.app.dom.svg, 'mousemove', { clientX: 300, clientY: 300 });
    mouse(h.app.dom.svg, 'mouseup', { clientX: 300, clientY: 300 });
    expect(h.app.getView().viewMode).toBe('logical');
    const t = h.lastTopo();
    expect(t.networks?.map((n) => n.name)).toContain('seg-01');
  });

  it('the segment panel edits prefix and fhrp with commit-on-change', () => {
    const h = harness(SEG_TOPO);
    (h.root.querySelector('#btnLogi') as HTMLElement).click();
    h.app.api.selectOnly('seg-1');
    expect(h.root.querySelector('#panel .pn-title')?.textContent).toContain('Network segment');
    setInput(h.root, '#panel input[data-fh="virtual_ip"]', '10.0.0.14/28');
    expect(h.lastTopo().networks?.[0]?.fhrp?.virtual_ip).toBe('10.0.0.14/28');
    h.ack();
    setInput(h.root, '#panel input[data-f="prefix"]', '10.0.0.0/27');
    expect(h.lastTopo().networks?.[0]?.prefix).toBe('10.0.0.0/27');
  });

  it('renaming a segment follows attachment references', () => {
    const h = harness({
      ...SEG_TOPO,
      logical_links: [{ a: { device: 'rt-1', vrf: 'PROD' }, b: { network: 'seg-1' } }],
    });
    (h.root.querySelector('#btnLogi') as HTMLElement).click();
    h.app.api.selectOnly('seg-1');
    setInput(h.root, '#panel input[data-f="name"]', 'svc-seg');
    const t = h.lastTopo();
    expect(t.networks?.[0]?.name).toBe('svc-seg');
    expect(t.logical_links?.[0]?.b.network).toBe('svc-seg');
  });
});

describe('New file button (toolbar)', () => {
  it('asks the host to run the New Topology File command (template QuickPick)', () => {
    const h = harness();
    (h.root.querySelector('#btnNewFile') as HTMLElement).click();
    expect(h.f.posted).toContainEqual({ type: 'new-file' });
  });
});

describe('AI guide button (toolbar)', () => {
  it('opens the explanation dialog; confirming posts the request and closes', () => {
    const h = harness();
    const modal = h.root.querySelector('#guideModal') as HTMLElement;
    expect(modal.style.display).not.toBe('flex');
    (h.root.querySelector('#btnAgentGuide') as HTMLElement).click();
    expect(modal.style.display).toBe('flex');
    expect(modal.textContent).toContain('AGENTS.md');
    // the append-not-overwrite behavior is called out prominently
    expect(modal.querySelector('.g-note')?.textContent).toContain('NOT overwritten');
    (h.root.querySelector('#guideWrite') as HTMLElement).click();
    expect(h.f.posted).toContainEqual({ type: 'agent-guide' });
    expect(modal.style.display).toBe('none');
  });

  it('the Save as… button requests a custom target file', () => {
    const h = harness();
    (h.root.querySelector('#btnAgentGuide') as HTMLElement).click();
    (h.root.querySelector('#guideSaveAs') as HTMLElement).click();
    expect(h.f.posted).toContainEqual({ type: 'agent-guide', saveAs: true });
  });

  it('cancelling posts nothing', () => {
    const h = harness();
    (h.root.querySelector('#btnAgentGuide') as HTMLElement).click();
    (h.root.querySelector('#guideCancel') as HTMLElement).click();
    expect(h.f.posted.some((m) => m.type === 'agent-guide')).toBe(false);
  });
});

describe('palette placement', () => {
  it('press on a palette item and release over the canvas adds the node there', () => {
    const h = harness();
    mouse(h.root.querySelector('[data-pal-role="router"]') as Element, 'mousedown');
    mouse(h.app.dom.svg, 'mousemove', { clientX: 300, clientY: 200 });
    mouse(h.app.dom.svg, 'mouseup', { clientX: 300, clientY: 200 });
    const t = h.lastTopo();
    const added = t.devices.find((d) => d.name === 'rt-01');
    expect(added).toMatchObject({ role: 'router', position: { x: 220, y: 170 } });
  });

  it('release outside the canvas cancels the placement', () => {
    const h = harness();
    const item = h.root.querySelector('[data-pal-role="router"]') as Element;
    mouse(item, 'mousedown');
    mouse(item, 'mouseup');
    expect(h.editCount()).toBe(0);
  });
});

describe('inline rename (double-click)', () => {
  it('renames a node with reference-following', () => {
    const h = harness();
    nodeEl(h.root, 'rt-1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const inp = h.root.querySelector('#inlineEdit') as HTMLInputElement;
    expect(inp.style.display).toBe('block');
    inp.value = 'edge-1';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const t = h.lastTopo();
    expect(t.devices[0]?.name).toBe('edge-1');
    expect(t.cables?.[0]?.a.device).toBe('edge-1');
  });

  it('renames a whole site from its label', () => {
    const h = harness();
    (h.root.querySelector('[data-site="HQ"]') as Element).dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );
    const inp = h.root.querySelector('#inlineEdit') as HTMLInputElement;
    inp.value = 'Tokyo';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const t = h.lastTopo();
    expect(t.devices.map((d) => d.site)).toEqual(['Tokyo', 'DC', 'Tokyo']);
  });
});
