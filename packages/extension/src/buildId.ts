/**
 * Build id compiled in by build.mjs (esbuild define); 'dev' when running
 * un-bundled (vitest, ts-node). Must resolve to the same value as the
 * webview bundle of the same build — see build.mjs for why.
 */
declare const __TOPODRAFT_BUILD__: string | undefined;

export const BUILD_ID: string =
  typeof __TOPODRAFT_BUILD__ === 'string' ? __TOPODRAFT_BUILD__ : 'dev';
