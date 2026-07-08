import { describe, expect, it } from 'vitest';
import { buildWebviewHtml } from '../src/webviewHtml';

const html = buildWebviewHtml({
  cspSource: 'https://webview.test',
  nonce: 'NONCE123',
  scriptUri: 'https://webview.test/dist/webview/webview.js',
  styleUri: 'https://webview.test/dist/webview/webview.css',
  locale: 'ja',
  buildId: 'b-123',
});

describe('buildWebviewHtml', () => {
  it('references the script with the nonce and the stylesheet', () => {
    expect(html).toContain('<script nonce="NONCE123" src="https://webview.test/dist/webview/webview.js">');
    expect(html).toContain('<link rel="stylesheet" href="https://webview.test/dist/webview/webview.css">');
    expect(html).toContain('<div id="root" data-locale="ja" data-build="b-123" data-png-scale="2">');
  });

  it('stamps the host build id for the stale-host check, rejecting junk', () => {
    expect(html).toContain('data-build="b-123"');
    const odd = buildWebviewHtml({
      cspSource: 'x',
      nonce: 'n',
      scriptUri: 's',
      styleUri: 'c',
      locale: 'en',
      buildId: '"><script>',
    });
    expect(odd).toContain('data-build="dev"');
  });

  it('injects the display language for the webview (D13), rejecting junk', () => {
    expect(html).toContain('<html lang="ja">');
    const odd = buildWebviewHtml({
      cspSource: 'x',
      nonce: 'n',
      scriptUri: 's',
      styleUri: 'c',
      locale: '"><script>',
      buildId: 'b',
    });
    expect(odd).toContain('data-locale="en"');
  });

  it('locks the CSP down: no remote code, nonce-only scripts, no inline styles', () => {
    const csp = /content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-NONCE123'");
    expect(csp).toContain('style-src https://webview.test');
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('stamps the PNG-export scale, clamped to 1–4 with a default of 2 (#10)', () => {
    expect(html).toContain('data-png-scale="2"'); // default when omitted
    const opts = {
      cspSource: 'x',
      nonce: 'n',
      scriptUri: 's',
      styleUri: 'c',
      locale: 'en',
      buildId: 'b',
    };
    expect(buildWebviewHtml({ ...opts, pngScale: 3 })).toContain('data-png-scale="3"');
    expect(buildWebviewHtml({ ...opts, pngScale: 99 })).toContain('data-png-scale="4"');
    expect(buildWebviewHtml({ ...opts, pngScale: -1 })).toContain('data-png-scale="1"');
    expect(buildWebviewHtml({ ...opts, pngScale: Number.NaN })).toContain('data-png-scale="2"');
  });
});
