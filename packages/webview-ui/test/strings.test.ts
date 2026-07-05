import { afterEach, describe, expect, it } from 'vitest';
import { STRINGS_EN, STRINGS_JA, T, currentLocale, fmt, initLocale } from '../src/strings';
import { createApp } from '../src/app';
import { fakeHost, mount } from './helpers';

afterEach(() => {
  initLocale('en');
  document.body.innerHTML = '';
});

describe('vendor neutrality (shipped UI text)', () => {
  // Named integration targets are allowed: NetBox (data source), draw.io /
  // diagrams.net (export format), coding-agent harnesses (Claude Code,
  // Copilot). Everything else stays generic — see kazuki's ruling.
  const banned =
    /(aws|azure|gcp|oci\b|oracle|equinix|direct\s*connect|fastconnect|expressroute|megaport|ntt|dxvif|dxcon|\bdx\b|cisco|juniper|arista|catalyst|nexus|ios-xe|junos|excalidraw|\bvisio\b|lucidchart)/i;

  it('mentions no product names beyond the allowed integration targets', () => {
    for (const [name, dict] of [
      ['en', STRINGS_EN],
      ['ja', STRINGS_JA],
    ] as const) {
      for (const [key, value] of Object.entries(dict)) {
        expect(banned.exec(String(value)), `${name}:${key}`).toBeNull();
      }
    }
  });
});

describe('dictionary completeness (D13)', () => {
  it('every English key has a Japanese translation', () => {
    for (const key of Object.keys(STRINGS_EN)) {
      expect(STRINGS_JA[key as keyof typeof STRINGS_JA], `missing ja: ${key}`).toBeTruthy();
    }
  });
});

describe('initLocale / T', () => {
  it('defaults to English and switches on ja variants', () => {
    expect(currentLocale()).toBe('en');
    initLocale('ja');
    expect(T('dev_title')).toBe('デバイス');
    initLocale('JA-jp');
    expect(currentLocale()).toBe('ja');
    initLocale('de');
    expect(currentLocale()).toBe('en');
    initLocale(undefined);
    expect(T('dev_title')).toBe('Device');
  });
});

describe('fmt', () => {
  it('substitutes {name} placeholders and leaves unknown ones intact', () => {
    expect(fmt('Copied {n} node(s) / {m} link(s)', { n: 2, m: 1 })).toBe(
      'Copied 2 node(s) / 1 link(s)',
    );
    expect(fmt('{a} and {b}', { a: 'x' })).toBe('x and {b}');
  });
});

describe('localized app boot', () => {
  it('renders the Japanese UI when the locale is ja', () => {
    initLocale('ja');
    const root = mount();
    const app = createApp(root, fakeHost().host);
    expect(root.querySelector('#btnPhys')?.textContent).toBe('物理');
    expect(root.querySelector('#btnLogi')?.textContent).toBe('論理');
    app.handleMessage({
      type: 'update',
      text: '{"version":1,"devices":[{"name":"a"}]}',
      docVersion: 1,
      selfOriginated: false,
    });
    expect(root.querySelector('#stCounts')?.textContent).toContain('デバイス');
    app.api.selectOnly('a');
    expect(root.querySelector('#panel .pn-title')?.textContent).toContain('デバイス');
  });
});
