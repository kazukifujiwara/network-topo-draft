import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

/** Lazily-created "TopoDraft" output channel (View → Output). */
export function log(message: string): void {
  channel = channel ?? vscode.window.createOutputChannel('TopoDraft');
  channel.appendLine(`[${new Date().toISOString()}] ${message}`);
}

export function disposeLog(): void {
  channel?.dispose();
  channel = undefined;
}
