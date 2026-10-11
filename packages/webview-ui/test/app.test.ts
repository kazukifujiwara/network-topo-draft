/**
 * Viewer behavior (plan §6.2 ⑥): the canvas follows document updates, keeps
 * the viewport, and implements the D11 invalid-JSON error view.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { fakeHost, mount, readFixture, update } from './helpers';

const SITE_CLOUD = readFixture('v6v7/site-cloud.topo.json');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('startup handshake', () => {
  it('warns (only) when the host runs an older bundle than the webview', () => {
    const f = fakeHost();
    const fresh = mount();
    createApp(fresh, { ...f.host, staleHost: true });
    const toast = fresh.querySelector('#toast') as HTMLElement;
    expect(toast.classList.contains('show')).toBe(true);
    expect(toast.textContent).toContain('Reload Window');

    const g = fakeHost();
    const ok = mount();
    createApp(ok, { ...g.host, staleHost: false });
    expect((ok.querySelector('#toast') as HTMLElement).classList.contains('show')).toBe(false);
  });

  it('posts ready exactly once so the host sends the initial update', () => {
    const f = fakeHost();
    createApp(mount(), f.host);
    expect(f.posted.filter((m) => m.type === 'ready')).toHaveLength(1);
    // the ＋New menu list is prefetched with the same handshake
    expect(f.posted).toEqual([{ type: 'ready' }, { type: 'list-templates' }]);
  });
});

describe('following document updates (Phase 1 exit criterion)', () => {
  it('renders the topology from an update message', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(update(SITE_CLOUD));
    expect(root.querySelectorAll('[data-node]')).toHaveLength(5); // 4 devices + 1 PN
    expect(root.querySelectorAll('.link-line.circuit')).toHaveLength(2);
    expect(root.querySelector('#stCounts')?.textContent).toBe(
      '4 devices · 1 provider nets · 5 links (2 cable / 2 circuit / 1 logical) · 2 sites',
    );
    expect(root.querySelector('#emptyHint')).toHaveProperty('style.display', 'none');
  });

  it('re-renders when the text changes (agent rewrite simulation)', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(update(SITE_CLOUD, 1));
    app.handleMessage(update(SITE_CLOUD.replaceAll('rt-hq-01', 'rt-renamed'), 2));
    const names = [...root.querySelectorAll('.node-name')].map((n) => n.textContent);
    expect(names).toContain('rt-renamed');
    expect(names).not.toContain('rt-hq-01');
    expect(app.getDocState().docVersion).toBe(2);
  });

  it('preserves the viewport across updates', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(update(SITE_CLOUD, 1));
    const vt = { ...app.getView().vt };
    app.handleMessage(update(SITE_CLOUD.replaceAll('rt-hq-01', 'rt-renamed'), 2));
    expect(app.getView().vt).toEqual(vt);
  });

  it('fits the view once on the very first successful parse (fresh state only)', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    const before = { ...app.getView().vt };
    app.handleMessage(update(SITE_CLOUD, 1));
    expect(app.getView().vt).not.toEqual(before);
  });

  it('a truly empty (0-byte / whitespace) file is a scaffold, not an error (#4)', () => {
    for (const text of ['', '   \n\t']) {
      const root = mount();
      const app = createApp(root, fakeHost().host);
      app.handleMessage(update(text));
      // no D11 error view — the friendly empty-canvas hint instead
      expect(root.querySelector('#errorBar')).toHaveProperty('style.display', 'none');
      expect(root.querySelector('#app')?.classList.contains('invalid')).toBe(false);
      expect(root.querySelector('#emptyHint')).toHaveProperty('style.display', 'block');
      // and editing is ENABLED: the model is a valid empty topology
      expect(app.getDocState().parseError).toBeNull();
      expect(app.getDocState().topology).toEqual({ version: 1, devices: [] });
      document.body.innerHTML = '';
    }
  });

  it('the first canvas edit on an empty file commits valid JSON', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(update(''));
    app.api.addNodeAt('router', 100, 100);
    const state = app.getDocState();
    expect(state.parseError).toBeNull();
    expect(state.topology?.devices).toHaveLength(1);
  });

  it('renders an empty file with the empty hint', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(update('{"version":1,"devices":[]}'));
    expect(root.querySelectorAll('[data-node]')).toHaveLength(0);
    expect(root.querySelector('#emptyHint')).toHaveProperty('style.display', 'block');
  });
});

describe('invalid-JSON resilience (ADR D11)', () => {
  it('keeps the last good canvas dimmed under an error bar, then recovers automatically', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(update(SITE_CLOUD, 1));
    app.handleMessage(update('{ agent is mid-edit', 2));

    expect(root.querySelector('#app')?.classList.contains('invalid')).toBe(true);
    expect(root.querySelector('#errorBar')).toHaveProperty('style.display', 'flex');
    expect(root.querySelector('#errorBar .em')?.textContent).toMatch(/JSON/i);
    // last good topology still drawn
    expect(root.querySelectorAll('[data-node]')).toHaveLength(5);
    expect(app.getDocState().docVersion).toBe(2);

    app.handleMessage(update(SITE_CLOUD, 3));
    expect(root.querySelector('#app')?.classList.contains('invalid')).toBe(false);
    expect(root.querySelector('#errorBar')).toHaveProperty('style.display', 'none');
  });

  it('shows the error view with an empty canvas when the file is invalid from the start', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(update('not json at all'));
    expect(root.querySelector('#errorBar')).toHaveProperty('style.display', 'flex');
    expect(root.querySelectorAll('[data-node]')).toHaveLength(0);
    expect(app.getDocState().topology).toBeNull();
  });

  it('treats semantically-broken-but-parseable JSON as an error view too (no devices array)', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(update(SITE_CLOUD, 1));
    app.handleMessage(update('{"devices": "oops"}', 2));
    expect(root.querySelector('#errorBar .em')?.textContent).toContain('devices');
    expect(root.querySelectorAll('[data-node]')).toHaveLength(5); // last good kept
  });
});

describe('view toggles and persistence (plan §4.3 / O4)', () => {
  const click = (root: HTMLElement, sel: string): void => {
    (root.querySelector(sel) as HTMLElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
  };

  it('logical view shows compartments, badge, legend, and the logical link above nodes', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(update(SITE_CLOUD));
    click(root, '#btnLogi');
    expect(app.getView().viewMode).toBe('logical');
    // global row on all 4 devices + PROD row on rt-hq-01
    expect(root.querySelectorAll('.vrf-row')).toHaveLength(5);
    expect(root.querySelector('#viewBadge')).toHaveProperty('style.display', 'block');
    expect(root.querySelector('#vrfLegend')?.textContent).toContain('PROD');
    expect(root.querySelectorAll('#lyLogi .link-line.logical')).toHaveLength(1);
    // endpoint id drawn next to the aws-tgw end
    expect(root.querySelector('#lyLogi .ep-id')?.textContent).toBe('tgw-attach-01');
  });

  describe('VRF filter (#46)', () => {
    const VRF_LITE = readFixture('v1/vrf-lite.topo.json');
    const menuVrfs = (root: HTMLElement): { vrf: string; checked: boolean }[] =>
      [...root.querySelectorAll<HTMLInputElement>('#vrfMenu input[data-vrf]')].map((i) => ({
        vrf: i.getAttribute('data-vrf') as string,
        checked: i.checked,
      }));
    const toggle = (root: HTMLElement, vrf: string): void =>
      (root.querySelector(`#vrfMenu input[data-vrf="${vrf}"]`) as HTMLInputElement).click();
    const btnText = (root: HTMLElement): string =>
      (root.querySelector('#btnVrf') as HTMLElement).textContent ?? '';

    it('the checklist pins global first, then every VRF, all checked by default', () => {
      const root = mount();
      const app = createApp(root, fakeHost().host);
      app.handleMessage(update(VRF_LITE));
      click(root, '#btnLogi');
      click(root, '#btnVrf');
      expect((root.querySelector('#vrfMenu') as HTMLElement).style.display).toBe('block');
      expect(menuVrfs(root)).toEqual([
        { vrf: '', checked: true },
        { vrf: 'blue', checked: true },
        { vrf: 'red', checked: true },
      ]);
      expect(btnText(root)).toBe('VRF ▾'); // no count while nothing is filtered
      expect(root.querySelector('#btnVrf')?.classList.contains('active')).toBe(false);
    });

    it('unchecking global hides the global compartments (the old Global toggle)', () => {
      const root = mount();
      const app = createApp(root, fakeHost().host);
      app.handleMessage(update(SITE_CLOUD));
      click(root, '#btnLogi');
      click(root, '#btnVrf');
      toggle(root, '');
      expect([...app.getView().hiddenVrfs]).toEqual(['']);
      expect(root.querySelectorAll('.vrf-row')).toHaveLength(1); // only PROD on rt-hq-01
      expect(btnText(root)).toBe('VRF 1/2 ▾');
      expect(root.querySelector('#btnVrf')?.classList.contains('active')).toBe(true);
    });

    it('isolating one VRF narrows rows, links, and segments; None/All reset', () => {
      const root = mount();
      const app = createApp(root, fakeHost().host);
      app.handleMessage(update(VRF_LITE));
      click(root, '#btnLogi');
      expect(root.querySelectorAll('.vrf-row')).toHaveLength(7); // rt-a/rt-b 3 rows, sw-a global
      expect(root.querySelectorAll('#lyLogi .link')).toHaveLength(6);
      click(root, '#btnVrf');
      (root.querySelectorAll('.vf-actions button')[1] as HTMLElement).click(); // None
      expect(root.querySelectorAll('.vrf-row')).toHaveLength(0);
      expect(root.querySelectorAll('#lyLogi .link')).toHaveLength(0);
      expect(root.querySelector('[data-node="seg-blue"]')).toBeNull(); // no attachment left
      expect(root.querySelectorAll('#lyLinks .link.dim')).toHaveLength(2); // underlay untouched
      toggle(root, 'blue');
      expect([...root.querySelectorAll('.vrf-row-label')].map((l) => l.textContent)).toEqual([
        'blue',
        'blue',
      ]);
      // blue-wan + the blue⇄red leak (either end visible) + 2 segment attachments
      expect(root.querySelectorAll('#lyLogi .link')).toHaveLength(4);
      expect(root.querySelector('[data-node="seg-blue"]')).not.toBeNull();
      expect(btnText(root)).toBe('VRF 1/3 ▾');
      (root.querySelectorAll('.vf-actions button')[0] as HTMLElement).click(); // All
      expect(app.getView().hiddenVrfs.size).toBe(0);
      expect(root.querySelectorAll('.vrf-row')).toHaveLength(7);
      expect(btnText(root)).toBe('VRF ▾');
    });

    it('persists the hidden set; a legacy showGlobal:false restores as a hidden global row', () => {
      const f = fakeHost();
      const root = mount();
      const app = createApp(root, f.host);
      app.handleMessage(update(VRF_LITE));
      click(root, '#btnLogi');
      click(root, '#btnVrf');
      toggle(root, 'red');
      expect(f.state()?.hiddenVrfs).toEqual(['red']);
      const app2 = createApp(mount(), f.host);
      expect([...app2.getView().hiddenVrfs]).toEqual(['red']);

      const legacy = fakeHost({
        vt: { x: 0, y: 0, k: 1 },
        viewMode: 'logical',
        underlayOn: true,
        showGlobal: false,
        gridOn: true,
      });
      const app3 = createApp(mount(), legacy.host);
      expect([...app3.getView().hiddenVrfs]).toEqual(['']);
    });

    it('the menu lives in the logical view only and closes on an outside click', () => {
      const root = mount();
      const app = createApp(root, fakeHost().host);
      app.handleMessage(update(VRF_LITE));
      expect((root.querySelector('#vrfWrap') as HTMLElement).style.display).toBe('none');
      click(root, '#btnLogi');
      expect((root.querySelector('#vrfWrap') as HTMLElement).style.display).toBe('');
      click(root, '#btnVrf');
      const menu = root.querySelector('#vrfMenu') as HTMLElement;
      expect(menu.style.display).toBe('block');
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(menu.style.display).toBe('none');
    });
  });

  it('Underlay off hides physical links in the logical view', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(update(SITE_CLOUD));
    click(root, '#btnLogi');
    expect(root.querySelectorAll('#lyLinks .link.dim')).toHaveLength(4);
    click(root, '#btnUnder');
    expect(root.querySelectorAll('#lyLinks .link.dim')).toHaveLength(0);
  });

  it('persists the view state through the host and restores it on the next boot', () => {
    const f = fakeHost();
    const root = mount();
    createApp(root, f.host);
    click(root, '#btnLogi');
    click(root, '#btnGrid');
    expect(f.state()?.viewMode).toBe('logical');
    expect(f.state()?.gridOn).toBe(false);

    const root2 = mount();
    const app2 = createApp(root2, f.host);
    expect(app2.getView().viewMode).toBe('logical');
    expect(app2.getView().gridOn).toBe(false);
  });
});
