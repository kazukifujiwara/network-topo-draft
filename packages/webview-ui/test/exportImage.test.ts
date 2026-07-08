/**
 * Image export from the webview (#10): the export menu and the palette
 * round-trip both produce a save-image message rendered from the CURRENT
 * view. PNG rasterization needs a real canvas (not available in jsdom) —
 * that path is covered by hands-on verification; here we assert the SVG
 * path and the invalid-document guard.
 */
import { describe, expect, it } from 'vitest';
import type { SaveImageMessage } from '@topodraft/protocol';
import { createApp } from '../src/app';
import { fakeHost, mount, readFixture, update } from './helpers';

const savedImages = (posted: unknown[]): SaveImageMessage[] =>
  posted.filter((m): m is SaveImageMessage => (m as { type?: string }).type === 'save-image');

describe('SVG export', () => {
  it('menu click posts a save-image message with the rendered SVG', () => {
    const f = fakeHost();
    const a = createApp(mount(), f.host);
    a.handleMessage(update(readFixture('v6v7/two-site-wan.topo.json')));
    const item = a.dom.app.querySelector<HTMLElement>('[data-export-image="svg"]');
    expect(item).not.toBeNull();
    (item as HTMLElement).click();
    const saved = savedImages(f.posted);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.format).toBe('svg');
    expect(saved[0]?.text).toContain('<svg ');
    expect(saved[0]?.text).toContain('⌖ Tokyo-HQ'); // scene content, current view
    expect(saved[0]?.view).toBe('physical'); // host keys the filename off this
  });

  it('renders the CURRENT view: logical view exports VRF compartments', () => {
    const f = fakeHost({
      vt: { x: 0, y: 0, k: 1 },
      viewMode: 'logical',
      underlayOn: true,
      showGlobal: true,
      gridOn: true,
    });
    const a = createApp(mount(), f.host);
    a.handleMessage(update(readFixture('v3/wan-logical.topo.json')));
    a.dom.app.querySelector<HTMLElement>('[data-export-image="svg"]')?.click();
    const saved = savedImages(f.posted);
    expect(saved[0]?.text).toContain('stroke-dasharray="1.5 6"'); // logical link style
    expect(saved[0]?.view).toBe('logical'); // → .logical filename suffix on the host
  });

  it('the export-image host message (palette round-trip) also produces save-image', () => {
    const f = fakeHost();
    const a = createApp(mount(), f.host);
    a.handleMessage(update(readFixture('v6v7/two-site-wan.topo.json')));
    a.handleMessage({ type: 'config', pngScale: 3 }); // live setting — must not crash
    a.handleMessage({ type: 'export-image', format: 'svg' });
    expect(savedImages(f.posted)).toHaveLength(1);
  });

  it('refuses while the document is invalid (D11) and shows a toast instead', () => {
    const f = fakeHost();
    const a = createApp(mount(), f.host);
    a.handleMessage(update(readFixture('v6v7/two-site-wan.topo.json')));
    a.handleMessage(update('{ this is not json', 2));
    a.dom.app.querySelector<HTMLElement>('[data-export-image="svg"]')?.click();
    expect(savedImages(f.posted)).toHaveLength(0);
    expect(a.dom.app.querySelector('#toast')?.textContent ?? '').toContain('JSON');
  });
});
