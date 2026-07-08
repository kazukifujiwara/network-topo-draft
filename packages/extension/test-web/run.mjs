// Web smoke runner: bundles the suite for the Web Worker extension host and
// launches @vscode/test-web (headless Chromium) against a throwaway
// workspace served as a virtual file system. Repo fixtures are never
// mutated — same pattern as test-e2e/run.mjs.
import { build } from 'esbuild';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-web';

const here = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = resolve(here, '..');
const repoRoot = resolve(here, '../../..');
const suiteOut = resolve(here, '../dist-web/suite.js');

// the test module runs in the same Web Worker as the extension — bundle it
// with the same browser/cjs shape as dist/extension-web.js
await build({
  entryPoints: [resolve(here, 'suite.ts')],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  external: ['vscode'],
  outfile: suiteOut,
  logLevel: 'warning',
});

const workspace = mkdtempSync(join(tmpdir(), 'topodraft-web-'));
cpSync(resolve(repoRoot, 'fixtures/v1/canonical.topo.json'), join(workspace, 'canonical.topo.json'));
writeFileSync(
  join(workspace, 'dangling.topo.json'),
  JSON.stringify(
    {
      version: 1,
      devices: [{ name: 'a' }],
      cables: [{ a: { device: 'a' }, b: { device: 'ghost' } }],
    },
    null,
    2,
  ) + '\n',
);

await runTests({
  browserType: 'chromium',
  headless: true,
  quality: 'stable',
  extensionDevelopmentPath,
  extensionTestsPath: suiteOut,
  // served as a virtual (vscode-test-web://) workspace — exactly the
  // environment vscode.dev / github.dev provide
  folderPath: workspace,
  // default 3000 collides with a manual `npx vscode-test-web` session
  // (runbook §2) — override with TOPODRAFT_WEB_PORT to run both at once
  // (globalThis: eslint has no node-globals block for these run scripts)
  port: Number(globalThis.process?.env?.TOPODRAFT_WEB_PORT) || undefined,
});
