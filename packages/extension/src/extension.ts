import * as vscode from 'vscode';
import { TopoEditorProvider } from './topoEditor';
import { registerDiagnostics } from './diagnosticsPublisher';
import { registerCommands } from './commands';
import { activeTabUri } from './activeDocument';

async function reopenActiveWith(viewType: string): Promise<void> {
  const uri = activeTabUri();
  if (uri) await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = registerDiagnostics();
  context.subscriptions.push(
    TopoEditorProvider.register(context),
    diagnostics,
    registerCommands(),
    // Convenience wrappers over reopen-with (plan §4.4), surfaced as
    // editor-title buttons so switching views is discoverable
    vscode.commands.registerCommand('topodraft.openAsText', () => reopenActiveWith('default')),
    vscode.commands.registerCommand('topodraft.openInTopologyEditor', () =>
      reopenActiveWith(TopoEditorProvider.viewType),
    ),
    vscode.commands.registerCommand('topodraft.validate', () => {
      const count = diagnostics.validateActive();
      if (count === null) {
        void vscode.window.showErrorMessage(
          vscode.l10n.t(
            'Open a *.topo.json file first — this command works on the active topology document.',
          ),
        );
      } else if (count === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('Network TopoDraft: no problems found.'));
      } else {
        void vscode.window.showWarningMessage(
          vscode.l10n.t('Network TopoDraft: {0} problem(s) — see the Problems panel.', count),
        );
      }
    }),
  );
}

export function deactivate(): void {
  // nothing to clean up: all disposables are on the extension context
}
