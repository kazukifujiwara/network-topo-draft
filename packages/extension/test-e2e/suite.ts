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

  g.describe('TopoDraft custom editor', () => {
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

    g.it('canvas edits go through WorkspaceEdit and Ctrl+Z undoes them (ADR D6)', async () => {
      const uri = wsFile('canonical.topo.json');
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      await waitFor(() => activeInput() instanceof vscode.TabInputCustom);
      const doc = await vscode.workspace.openTextDocument(uri);
      const original = doc.getText();
      // what the webview would send after a canvas rename (serialized model)
      const modified = original.split('rt-hq-01').join('rt-canvas-renamed');
      const outcome = await vscode.commands.executeCommand(
        'topodraft.__test.simulateCanvasEdit',
        uri,
        modified,
        doc.version,
      );
      assert.strictEqual(outcome, 'applied');
      assert.strictEqual(doc.getText(), modified);
      // undo is VSCode's document history — no editor-internal undo exists
      await vscode.commands.executeCommand('undo');
      await waitFor(() => doc.getText() === original);
      await vscode.commands.executeCommand('redo');
      await waitFor(() => doc.getText() === modified);
    });

    g.it('discards canvas edits computed against a stale version (plan §4.2 race guard)', async () => {
      const uri = wsFile('site-cloud.topo.json');
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
      await waitFor(() => activeInput() instanceof vscode.TabInputCustom);
      const doc = await vscode.workspace.openTextDocument(uri);
      const before = doc.getText();
      const outcome = await vscode.commands.executeCommand(
        'topodraft.__test.simulateCanvasEdit',
        uri,
        '{"version":1,"devices":[{"name":"stale-canvas"}]}\n',
        doc.version - 1,
      );
      assert.strictEqual(outcome, 'discarded-stale');
      assert.strictEqual(doc.getText(), before);
    });

    g.it('publishes semantic diagnostics to the Problems panel (Phase 3 exit criterion)', async () => {
      const uri = wsFile('dangling.topo.json');
      await vscode.commands.executeCommand('vscode.open', uri);
      await waitFor(() =>
        vscode.languages.getDiagnostics(uri).some((d) => d.source === 'topodraft'),
      );
      const ours = vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'topodraft');
      assert.strictEqual(ours.length, 1);
      assert.strictEqual(ours[0]?.code, 'dangling-reference');
      assert.strictEqual(ours[0]?.severity, vscode.DiagnosticSeverity.Error);
      // the range points at the offending reference, so an agent can fix it
      const doc = await vscode.workspace.openTextDocument(uri);
      assert.strictEqual(doc.getText(ours[0]?.range), '"ghost"');

      // agent self-correction loop: fixing the text clears the problem
      await replaceAll(uri, doc.getText().replace('"ghost"', '"a"'));
      await waitFor(
        () => vscode.languages.getDiagnostics(uri).every((d) => d.source !== 'topodraft'),
      );
    });

    g.it('export command reflects UNSAVED in-editor edits, not the file on disk', async () => {
      const uri = wsFile('site-cloud.topo.json');
      await vscode.commands.executeCommand('vscode.open', uri);
      await waitFor(() => activeInput() instanceof vscode.TabInputCustom);
      // simulate an in-progress editing session: dirty document, never saved
      const doc = await vscode.workspace.openTextDocument(uri);
      await replaceAll(uri, doc.getText().split('rt-hq-01').join('rt-unsaved-rename'));
      assert.ok(doc.isDirty, 'document should be dirty (unsaved)');
      await vscode.commands.executeCommand('topodraft.exportMarkdown');
      await waitFor(() => vscode.window.activeTextEditor?.document.languageId === 'markdown');
      const preview = vscode.window.activeTextEditor?.document.getText() ?? '';
      assert.ok(preview.includes('# Network Configuration'));
      assert.ok(preview.includes('rt-unsaved-rename'), 'export must use the live document');
      assert.ok(!preview.includes('rt-hq-01'), 'export must NOT use the saved file contents');
      // leave the workspace file untouched for the other tests
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await replaceAll(uri, doc.getText().split('rt-unsaved-rename').join('rt-hq-01'));
    });

    g.it('writes an idempotent AGENTS.md so agents learn the format up front', async () => {
      await vscode.commands.executeCommand('topodraft.writeAgentGuide');
      const uri = wsFile('AGENTS.md');
      const first = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      assert.ok(first.includes('topodraft:agent-guide:begin'));
      assert.ok(first.includes('ip_address'));
      assert.ok(first.includes('JSON Schema'));
      await vscode.commands.executeCommand('topodraft.writeAgentGuide');
      const second = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      assert.strictEqual(second, first, 'regeneration must be idempotent');
    });

    g.it('validate command runs against the active topology document', async () => {
      await vscode.commands.executeCommand('vscode.open', wsFile('canonical.topo.json'));
      await waitFor(() => activeInput() instanceof vscode.TabInputCustom);
      await vscode.commands.executeCommand('topodraft.validate'); // must not throw
    });

    g.it('new-file template picker survives the focus flip of a webview-button trigger', async () => {
      // The toolbar ＋New button posts a message from the webview; the webview
      // re-takes focus right after the click, which dismisses a default
      // QuickPick before it is visible (microsoft/vscode#214787). The picker
      // must set ignoreFocusOut so the command still works from the canvas.
      await vscode.commands.executeCommand('vscode.open', wsFile('canonical.topo.json'));
      await waitFor(() => activeInput() instanceof vscode.TabInputCustom);
      let settled = false;
      const done = vscode.commands.executeCommand('topodraft.newFile').then(
        () => (settled = true),
        () => (settled = true),
      );
      await sleep(700); // let the QuickPick open
      // simulate the focus theft that dismisses a non-ignoreFocusOut picker
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      await sleep(700);
      assert.strictEqual(settled, false, 'the template picker was dismissed by the focus change');
      await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
      await waitFor(() => settled, 5_000);
      await done;
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
