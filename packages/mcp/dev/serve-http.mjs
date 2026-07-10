// DEV-ONLY runner (#30): bundles src/dev-http.ts on the fly and runs it.
// Usage (from the repo root):  node packages/mcp/dev/serve-http.mjs
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(here, '.build/serve-http.mjs');

await build({
  entryPoints: [resolve(here, '../src/dev-http.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  mainFields: ['module', 'main'],
  outfile,
  logLevel: 'warning',
});

await import(pathToFileURL(outfile).href);
