// CLI build: one self-contained executable bundle (core + the extension's
// pure diagnostics module + jsonc-parser), same approach as the extension.
import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')).version;

await build({
  entryPoints: [resolve(here, 'src/cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  // prefer ESM entry points — jsonc-parser's UMD "main" breaks under esbuild
  // (same lesson as the extension host bundle)
  mainFields: ['module', 'main'],
  banner: { js: '#!/usr/bin/env node' },
  define: { __CLI_VERSION__: JSON.stringify(version) },
  outfile: resolve(here, 'dist/cli.js'),
  logLevel: 'warning',
});

// npm includes LICENSE/NOTICE from the package root automatically
await copyFile(resolve(here, '../../LICENSE'), resolve(here, 'LICENSE'));
await copyFile(resolve(here, '../../NOTICE'), resolve(here, 'NOTICE'));
