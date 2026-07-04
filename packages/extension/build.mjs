// Extension build: host bundle + webview bundle + bundled schema copy.
// The webview is bundled directly from packages/webview-ui sources so the
// output never depends on workspace build order.
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(here, 'src/extension.ts')],
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

await build({
  entryPoints: [resolve(here, '../webview-ui/src/main.ts')],
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
