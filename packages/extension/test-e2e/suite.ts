/**
 * In-host E2E suite (plan §6.2 ⑦, Phase 1 subset): custom-editor launch,
 * default association, non-matching files untouched, external (agent) edits
 * survive — including invalid JSON — with no write-back (ADR D11), and the
 * reopen convenience commands.
 *
 * Canvas-internal behavior (rendering, error view content, viewport) is
 * covered by the webview-ui jsdom tests — the webview DOM is not reachable
 * from this host process.
 */
import * as assert from 'node:assert';
import Mocha from 'mocha';
import * as vscode from 'vscode';

const EXTENSION_ID = 'kazukifujiwara.topodraft';
const VIEW_TYPE = 'topodraft.editor';

export function run(): Promise<void> {
  return new Promise((resolve, reject) => {
    // One retry absorbs first-launch slowness of a freshly downloaded VSCode
    // (the cold start can exceed even generous waits, especially in CI).
    const mocha = new Mocha({ ui: 'bdd', timeout: 60_000, color: true, retries: 1 });
    mocha.suite.emit('pre-require', globalThis, 'suite', mocha);
    defineTests();
    mocha.run((failures) =>
      failures ? reject(new Error(`${failures} e2e test(s) failed.`)) : resolve(),
    );
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, ms = 30_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await sleep(100);
  }
}

function activeInput(): unknown {
  return vscode.window.tabGroups.activeTabGroup.activeTab?.input;
}

function wsFile(name: string): vscode.Uri {
  const ws = vscode.workspace.workspaceFolders;
  assert.ok(ws && ws.length, 'test workspace missing');
  return vscode.Uri.joinPath(ws[0].uri, name);
}

async function replaceAll(uri: vscode.Uri, text: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
  assert.ok(await vscode.workspace.applyEdit(edit), 'applyEdit failed');
}

function defineTests(): void {
  const g = globalThis as unknown as {
    describe: Mocha.SuiteFunction;
    it: Mocha.TestFunction;
    afterEach: Mocha.HookFunction;
  };

  g.describe('Network TopoDraft custom editor (Phase 1)', () => {
    g.afterEach(async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    g.it('opens *.topo.json in the topology editor by default and activates the extension', async () => {
      await vscode.commands.executeCommand('vscode.open', wsFile('canonical.topo.json'));
      await waitFor(() => activeInput() instanceof vscode.TabInputCustom);
      const input = activeInput() as vscode.TabInputCustom;
      assert.strictEqual(input.viewType, VIEW_TYPE);
      const ext = vscode.extensions.getExtension(EXTENSION_ID);
      assert.ok(ext, 'extension not found');
      await waitFor(() => ext.isActive);
    });

    g.it('leaves non-matching .json files to the text editor', async () => {
      await vscode.commands.executeCommand('vscode.open', wsFile('plain.json'));
      await waitFor(() => activeInput() !== undefined);
      assert.ok(activeInput() instanceof vscode.TabInputText);
    });

    g.it('survives external (agent) edits including invalid JSON and never writes back (D11)', async () => {
      const uri = wsFile('site-cloud.topo.json');
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      await waitFor(() => activeInput() instanceof vscode.TabInputCustom);
      const doc = await vscode.workspace.openTextDocument(uri);

      const broken = '{ this is not json';
      await replaceAll(uri, broken);
      await sleep(800); // give any (unexpected) write-back a chance to happen
      assert.strictEqual(doc.getText(), broken, 'document must stay exactly as the agent left it');

      const valid = '{"version":1,"devices":[{"name":"agent-added"}]}\n';
      await replaceAll(uri, valid);
      await sleep(800);
      assert.strictEqual(doc.getText(), valid);
    });

    g.it('reopen commands switch between the text and topology editors', async () => {
      await vscode.commands.executeCommand('vscode.open', wsFile('canonical.topo.json'));
      await waitFor(() => activeInput() instanceof vscode.TabInputCustom);

      await vscode.commands.executeCommand('topodraft.openAsText');
      await waitFor(() => activeInput() instanceof vscode.TabInputText);

      await vscode.commands.executeCommand('topodraft.openInTopologyEditor');
      await waitFor(() => activeInput() instanceof vscode.TabInputCustom);
      assert.strictEqual((activeInput() as vscode.TabInputCustom).viewType, VIEW_TYPE);
    });
  });
}
