// Extension build: host bundle + webview bundle + bundled schema copy.
// The webview is bundled directly from packages/webview-ui sources so the
// output never depends on workspace build order.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// Shared build id, compiled into BOTH bundles. Reinstalling a same-version
// VSIX overwrites dist/ in place while the running extension host keeps the
// old extension.js in memory — a freshly opened editor then loads the NEW
// webview.js from disk against the OLD host. The webview compares its
// compiled id with the one the host stamps into the HTML and asks for a
// window reload on mismatch.
const buildId = Date.now().toString(36);
const define = { __TOPODRAFT_BUILD__: JSON.stringify(buildId) };

await build({
  entryPoints: [resolve(here, 'src/extension.ts')],
  define,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  // prefer ESM entry points: jsonc-parser's UMD "main" uses AMD-style
  // dependencies esbuild cannot statically bundle (runtime
  // "Cannot find module './impl/format'")
  mainFields: ['module', 'main'],
  outfile: resolve(here, 'dist/extension.js'),
  logLevel: 'warning',
});

// Web extension host (vscode.dev / github.dev): the same sources compiled
// for a browser Web Worker (additive — the desktop `main` bundle above is
// untouched). Workers have no `process`, so the desktop-only E2E hook gate
// is folded out at build time via define.
await build({
  entryPoints: [resolve(here, 'src/extension.ts')],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  external: ['vscode'],
  mainFields: ['module', 'main'],
  define: { ...define, 'process.env.TOPODRAFT_E2E': 'undefined' },
  outfile: resolve(here, 'dist/extension-web.js'),
  logLevel: 'warning',
});

await build({
  entryPoints: [resolve(here, '../webview-ui/src/main.ts')],
  define,
  bundle: true,
  format: 'iife',
  outfile: resolve(here, 'dist/webview/webview.js'),
  logLevel: 'warning',
});

// jsonValidation needs the schema inside the extension folder (plan §4.5)
await mkdir(resolve(here, 'schema'), { recursive: true });
await copyFile(
  resolve(here, '../../schema/topodraft.schema.json'),
  resolve(here, 'schema/topodraft.schema.json'),
);

// vsce packages LICENSE/CHANGELOG from the extension folder — copy the
// repo-level ones (both build outputs, gitignored)
await copyFile(resolve(here, '../../LICENSE'), resolve(here, 'LICENSE'));
await copyFile(resolve(here, '../../NOTICE'), resolve(here, 'NOTICE'));
await copyFile(resolve(here, '../../CHANGELOG.md'), resolve(here, 'CHANGELOG.md'));
