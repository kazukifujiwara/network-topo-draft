// E2E runner (plan §6.2 ⑦): downloads VSCode, launches an Extension
// Development Host on a throwaway workspace of fixture copies, and runs the
// bundled mocha suite inside it. Repo fixtures are never mutated.
import { build } from 'esbuild';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const here = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = resolve(here, '..');
const repoRoot = resolve(here, '../../..');
const suiteOut = resolve(here, '../dist-e2e/suite.js');

await build({
  entryPoints: [resolve(here, 'suite.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode', 'mocha'],
  outfile: suiteOut,
  logLevel: 'warning',
});

const workspace = mkdtempSync(join(tmpdir(), 'topodraft-e2e-'));
cpSync(resolve(repoRoot, 'fixtures/v1/canonical.topo.json'), join(workspace, 'canonical.topo.json'));
cpSync(resolve(repoRoot, 'fixtures/v6v7/site-cloud.topo.json'), join(workspace, 'site-cloud.topo.json'));
writeFileSync(join(workspace, 'plain.json'), '{"not":"topodraft"}\n');

await runTests({
  extensionDevelopmentPath,
  extensionTestsPath: suiteOut,
  // enables the topodraft.__test.simulateCanvasEdit hook (see topoEditor.ts)
  extensionTestsEnv: { TOPODRAFT_E2E: '1' },
  launchArgs: [
    workspace,
    '--disable-extensions',
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
  ],
});
