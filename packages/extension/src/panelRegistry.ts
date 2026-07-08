/**
 * Open topology-editor panels by document uri (#10). Lets the palette
 * image-export commands reach the webview of an open editor — the webview
 * knows the CURRENT view (physical/logical, underlay, global row) and owns
 * the only canvas (PNG rasterization), so "export what I see" must go
 * through it. Kept out of commands.ts/topoEditor.ts to avoid an import
 * cycle between them.
 */
import type * as vscode from 'vscode';
import type { ImageFormat } from '@topodraft/protocol';

const panels = new Map<string, vscode.WebviewPanel>();

export function registerPanel(uri: vscode.Uri, panel: vscode.WebviewPanel): void {
  panels.set(uri.toString(), panel);
}

export function unregisterPanel(uri: vscode.Uri, panel: vscode.WebviewPanel): void {
  if (panels.get(uri.toString()) === panel) panels.delete(uri.toString());
}

/**
 * Ask the open editor for this document to render an image of its current
 * view; it replies with a save-image message. False when no editor is open.
 */
export function requestImageFromEditor(uri: vscode.Uri, format: ImageFormat): boolean {
  const panel = panels.get(uri.toString());
  // retainContextWhenHidden is false: a hidden webview is destroyed and
  // never receives messages — treat it like no editor at all
  if (!panel || !panel.visible) return false;
  void panel.webview.postMessage({ type: 'export-image', format });
  return true;
}
