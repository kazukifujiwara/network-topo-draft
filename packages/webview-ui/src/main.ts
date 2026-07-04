/**
 * Webview entry point: wires createApp to the real VSCode webview API.
 * Everything testable lives in app.ts/scene.ts; this file stays a thin shell.
 */
import type { PersistedViewState } from './app';
import { createApp } from './app';
import { BUILD_ID } from './buildId';
import { initLocale } from './strings';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById('root');
if (!root) throw new Error('webview root element missing');
// the extension injects the VSCode display language (ADR D13)
initLocale(root.dataset.locale);

const app = createApp(root, {
  postMessage: (m) => vscode.postMessage(m),
  getState: () => vscode.getState() as PersistedViewState | undefined,
  setState: (s) => vscode.setState(s),
  // old hosts stamp no data-build at all — that counts as a mismatch too
  staleHost: root.dataset.build !== BUILD_ID,
});

window.addEventListener('message', (e: MessageEvent) => {
  app.handleMessage(e.data);
});
