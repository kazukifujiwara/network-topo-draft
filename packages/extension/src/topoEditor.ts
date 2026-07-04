/**
 * CustomTextEditorProvider for *.topo.json (ADR D1: the TextDocument is the
 * source of truth; the webview is a view of it).
 *
 * Phase 2: the webview sends full-text edit requests (serialized canvas
 * state + the docVersion it was based on); DocumentSyncController applies
 * them as WorkspaceEdits only when the version still matches (plan §4.2).
 * Undo/redo is entirely VSCode's document history (ADR D6).
 */
import * as vscode from 'vscode';
import { buildWebviewHtml } from './webviewHtml';
import { getNonce } from './sync';
import {
  DocumentSyncController,
  isAgentGuideRequest,
  isEditMessage,
  isExportRequest,
  isNewFileRequest,
  isReadyMessage,
} from './documentSync';
import { runExport } from './commands';

export class TopoEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'topodraft.editor';

  /** Active sync controllers by document uri — used by the E2E test hook. */
  private readonly sessions = new Map<string, DocumentSyncController>();

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new TopoEditorProvider(context);
    const disposables: vscode.Disposable[] = [
      vscode.window.registerCustomEditorProvider(TopoEditorProvider.viewType, provider, {
        // Do not retain the webview when hidden (plan §4.3 / O4): view state
        // is restored via the webview's getState/setState.
        webviewOptions: { retainContextWhenHidden: false },
      }),
    ];
    // Test-only hook: lets the E2E suite drive the REAL edit path
    // (controller → WorkspaceEdit → undo stack) since the webview DOM is not
    // reachable from the extension-test process. Gated on an env var set by
    // test-e2e/run.mjs; never registered in normal sessions.
    if (process.env.TOPODRAFT_E2E === '1') {
      disposables.push(
        vscode.commands.registerCommand(
          'topodraft.__test.simulateCanvasEdit',
          (uri: vscode.Uri, text: string, baseVersion: number) => {
            const session = provider.sessions.get(uri.toString());
            if (!session) throw new Error(`no topodraft editor session for ${uri.toString()}`);
            return session.handleEdit({ type: 'edit', text, baseVersion });
          },
        ),
      );
    }
    return vscode.Disposable.from(...disposables);
  }

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): void {
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [distRoot],
    };
    const webviewUri = (...parts: string[]): string =>
      webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(distRoot, ...parts)).toString();
    webviewPanel.webview.html = buildWebviewHtml({
      cspSource: webviewPanel.webview.cspSource,
      nonce: getNonce(),
      scriptUri: webviewUri('webview', 'webview.js'),
      styleUri: webviewUri('webview', 'webview.css'),
      locale: vscode.env.language,
    });

    const controller = new DocumentSyncController({
      getText: () => document.getText(),
      getVersion: () => document.version,
      applyFullTextEdit: (newText: string) => {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
          newText,
        );
        return vscode.workspace.applyEdit(edit);
      },
      postToWebview: (message) => void webviewPanel.webview.postMessage(message),
    });
    this.sessions.set(document.uri.toString(), controller);

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        controller.handleDocumentChanged();
      }
    });
    const messageSub = webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      if (isReadyMessage(message)) controller.handleReady();
      else if (isEditMessage(message)) void controller.handleEdit(message);
      else if (isExportRequest(message)) void runExport(message.kind, document.uri);
      else if (isAgentGuideRequest(message)) {
        void vscode.commands.executeCommand('topodraft.writeAgentGuide', message.saveAs === true);
      } else if (isNewFileRequest(message)) {
        void vscode.commands.executeCommand('topodraft.newFile');
      }
    });
    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      messageSub.dispose();
      if (this.sessions.get(document.uri.toString()) === controller) {
        this.sessions.delete(document.uri.toString());
      }
    });
  }
}
