import * as vscode from 'vscode';
import { TopoEditorProvider } from './topoEditor';

/** Uri of the active tab when it is a text or custom editor. */
function activeTabUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
    return input.uri;
  }
  return undefined;
}

async function reopenActiveWith(viewType: string): Promise<void> {
  const uri = activeTabUri();
  if (uri) await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    TopoEditorProvider.register(context),
    // Convenience wrappers over reopen-with (plan §4.4)
    vscode.commands.registerCommand('topodraft.openAsText', () => reopenActiveWith('default')),
    vscode.commands.registerCommand('topodraft.openInTopologyEditor', () =>
      reopenActiveWith(TopoEditorProvider.viewType),
    ),
  );
}

export function deactivate(): void {
  // nothing to clean up: all disposables are on the extension context
}
