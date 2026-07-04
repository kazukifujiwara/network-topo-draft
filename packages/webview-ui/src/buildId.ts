/**
 * Build id compiled in by the extension's build.mjs (esbuild define); 'dev'
 * when running un-bundled (vitest). The host stamps its own id into the
 * HTML (data-build); a mismatch means the extension host is still running
 * an older bundle than the webview loaded from disk (same-version VSIX
 * reinstall without a window reload) — the app then asks for a reload.
 */
declare const __TOPODRAFT_BUILD__: string | undefined;

export const BUILD_ID: string =
  typeof __TOPODRAFT_BUILD__ === 'string' ? __TOPODRAFT_BUILD__ : 'dev';
