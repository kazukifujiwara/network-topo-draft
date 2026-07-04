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
  it('posts ready exactly once so the host sends the initial update', () => {
    const f = fakeHost();
    createApp(mount(), f.host);
    expect(f.posted).toEqual([{ type: 'ready' }]);
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

  it('Global off hides the global compartments', () => {
    const root = mount();
    const app = createApp(root, fakeHost().host);
    app.handleMessage(update(SITE_CLOUD));
    click(root, '#btnLogi');
    click(root, '#btnGlobal');
    expect(app.getView().showGlobal).toBe(false);
    expect(root.querySelectorAll('.vrf-row')).toHaveLength(1); // only PROD on rt-hq-01
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
