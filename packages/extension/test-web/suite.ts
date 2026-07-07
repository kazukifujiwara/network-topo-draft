/**
 * Web-extension smoke test (@vscode/test-web): proves the browser bundle
 * (dist/extension-web.js) activates inside a Web Worker extension host and
 * that the core flows work against a VIRTUAL (non-file-scheme) workspace —
 * the custom editor claims *.topo.json and semantic diagnostics run in the
 * worker. The full behavior matrix stays with the desktop E2E suite; this
 * exists to catch web-specific regressions (Node API leaks, file-scheme
 * assumptions).
 *
 * No mocha here: @vscode/test-web loads this module in the worker and
 * awaits the exported run() — a rejected promise fails the run.
 */
import * as vscode from 'vscode';

const EXTENSION_ID = 'kazukifujiwara.topodraft';
const VIEW_TYPE = 'topodraft.editor';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(what: string, cond: () => boolean, ms = 60_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`web smoke failed: ${message}`);
}

export async function run(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  assert(folders && folders.length, 'test workspace missing');
  const root = folders[0]!.uri;
  // the whole point of web support: the workspace is virtual, not file://
  assert(root.scheme !== 'file', `expected a virtual workspace, got scheme "${root.scheme}"`);

  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert(ext, 'extension not found in the web extension host');
  await ext.activate();
  assert(ext.isActive, 'extension did not activate');

  // the custom editor claims *.topo.json on the web UI
  await vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(root, 'canonical.topo.json'));
  await waitFor('the topology editor tab', () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE;
  });

  // zero-setup onboarding: the example opens as an untitled doc on web too
  await vscode.commands.executeCommand('topodraft.openExample');
  await waitFor('the example topology tab', () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return (
      input instanceof vscode.TabInputCustom &&
      input.viewType === VIEW_TYPE &&
      input.uri.scheme === 'untitled'
    );
  });

  // semantic diagnostics run inside the worker (core + jsonc-parser bundled)
  const bad = vscode.Uri.joinPath(root, 'dangling.topo.json');
  await vscode.commands.executeCommand('vscode.open', bad);
  await waitFor('topodraft diagnostics on the virtual document', () =>
    vscode.languages
      .getDiagnostics(bad)
      .some((d) => d.source === 'topodraft' && d.code === 'dangling-reference'),
  );
}
