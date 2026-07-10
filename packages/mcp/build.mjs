// MCP server build: one self-contained executable bundle (core + the CLI's
// pure validation + the MCP SDK's stdio server path + the MCP Apps widget
// document), same approach as the CLI. Everything ships bundled so the
// published package has zero runtime dependencies and `npx topodraft-mcp`
// starts instantly.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const version = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')).version;

// the widget document is imported as text (#30) — make sure it is fresh
// regardless of workspace build order
execFileSync('node', [resolve(here, '../app-view/build.mjs')], { stdio: 'inherit' });

await build({
  entryPoints: [resolve(here, 'src/mcp.ts')],
  bundle: true,
  platform: 'node',
  // the SDK is ESM-first and uses top-level constructs that survive best as ESM
  format: 'esm',
  mainFields: ['module', 'main'],
  banner: { js: '#!/usr/bin/env node' },
  define: { __MCP_VERSION__: JSON.stringify(version) },
  loader: { '.html': 'text' },
  outfile: resolve(here, 'dist/mcp.js'),
  logLevel: 'warning',
});

// npm includes LICENSE/NOTICE from the package root automatically
await copyFile(resolve(here, '../../LICENSE'), resolve(here, 'LICENSE'));
await copyFile(resolve(here, '../../NOTICE'), resolve(here, 'NOTICE'));
