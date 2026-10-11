import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebviewToHostMessage } from '@topodraft/protocol';
import { mountAppView } from '../src/mount';

const HERE = dirname(fileURLToPath(import.meta.url));
const readFixture = (p: string): string =>
  readFileSync(resolve(HERE, '../../../fixtures', p), 'utf8');

function mount(): { root: HTMLElement; posted: WebviewToHostMessage[] } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return { root, posted: [] };
}

describe('mountAppView (#28): the canvas renders without VSCode', () => {
  it('renders a fixture topology from plain update() calls', () => {
    const { root } = mount();
    const view = mountAppView(root);
    view.update(readFixture('v6v7/two-site-wan.topo.json'));
    expect(root.querySelectorAll('[data-node]')).toHaveLength(6);
    const sites = [...root.querySelectorAll('.site-label')].map((l) => l.textContent);
    expect(sites).toEqual(['⌖ Tokyo-HQ', '⌖ Osaka-DC']);
  });

  it('re-renders on subsequent updates (docVersion advances internally)', () => {
    const { root } = mount();
    const view = mountAppView(root);
    view.update('{"version":1,"devices":[{"name":"a"}]}');
    expect(root.querySelectorAll('[data-node]')).toHaveLength(1);
    view.update('{"version":1,"devices":[{"name":"a"},{"name":"b"}]}');
    expect(root.querySelectorAll('[data-node]')).toHaveLength(2);
  });

  it('surfaces outbound canvas messages to the bridge hook', () => {
    const { root } = mount();
    const posted: WebviewToHostMessage[] = [];
    mountAppView(root, { onMessage: (m) => posted.push(m) });
    // createApp announces itself on startup — the bridge decides what to do
    expect(posted.map((m) => m.type)).toContain('ready');
  });

  it('applies a VRF filter from the settings and re-derives it per update (#46)', () => {
    const { root } = mount();
    const view = mountAppView(root);
    const text = readFixture('v1/vrf-lite.topo.json');
    view.update(text, { view: 'logical', underlay: true, vrfs: ['blue'] });
    const labels = () => [...root.querySelectorAll('.vrf-row-label')].map((l) => l.textContent);
    expect(labels()).toEqual(['blue', 'blue']);
    expect(root.querySelector('[data-node="seg-blue"]')).not.toBeNull();
    // same settings, a VRF added to the file: the filter still applies
    const grown = text.replace('"blue",\n        "red"', '"blue",\n        "red",\n        "green"');
    view.update(grown, { view: 'logical', underlay: true, vrfs: ['blue'] });
    expect(labels()).toEqual(['blue', 'blue']);
    // dropping the filter shows everything again
    view.update(text, { view: 'logical', underlay: true });
    expect(labels()).toContain('red');
    expect(labels()).toContain('global');
  });

  it('works without an onMessage hook (messages are dropped silently)', () => {
    const { root } = mount();
    expect(() => {
      const view = mountAppView(root);
      view.update(readFixture('v1/canonical.topo.json'));
    }).not.toThrow();
  });
});
