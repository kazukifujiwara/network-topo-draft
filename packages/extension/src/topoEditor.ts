/**
 * CustomTextEditorProvider for *.topo.json (ADR D1: the TextDocument is the
 * source of truth; the webview is a view of it).
 *
 * Phase 1 scope: read-only rendering that follows text changes. The webview
 * never sends edits, so nothing here writes to the document (ADR D11).
 */
import * as vscode from 'vscode';
import { buildWebviewHtml } from './webviewHtml';
import { getNonce, isReadyMessage, makeUpdateMessage } from './sync';

export class TopoEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'topodraft.editor';

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      TopoEditorProvider.viewType,
      new TopoEditorProvider(context),
      // Do not retain the webview when hidden (plan §4.3 / O4): view state is
      // restored via the webview's getState/setState.
      { webviewOptions: { retainContextWhenHidden: false } },
    );
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
    });

    const postUpdate = (): void => {
      void webviewPanel.webview.postMessage(
        makeUpdateMessage(document.getText(), document.version),
      );
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) postUpdate();
    });
    const messageSub = webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
      if (isReadyMessage(message)) postUpdate();
    });
    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      messageSub.dispose();
    });
  }
}
