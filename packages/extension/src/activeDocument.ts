import * as vscode from 'vscode';

export function isTopoDocument(document: vscode.TextDocument): boolean {
  return document.uri.path.endsWith('.topo.json');
}

/** Uri of the active tab when it is a text or custom editor. */
export function activeTabUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
    return input.uri;
  }
  return undefined;
}

/** Uri of the active tab when it is a *.topo.json document. */
export function activeTopoUri(): vscode.Uri | undefined {
  const uri = activeTabUri();
  return uri?.path.endsWith('.topo.json') ? uri : undefined;
}
