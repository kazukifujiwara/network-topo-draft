/**
 * Mounting seam for the MCP Apps widget (#28): renders the TopoDraft canvas
 * from a plain DOM root with an injected AppHost — no acquireVsCodeApi, no
 * VSCode. The MCP Apps bridge (#29) constructs the host side and feeds
 * updates through the returned handle; this module stays transport-agnostic
 * so tests can drive it directly.
 */
import type { AppHost } from '@topodraft/webview-ui';
import { createApp, initLocale } from '@topodraft/webview-ui';
import type { HostToWebviewMessage, WebviewToHostMessage } from '@topodraft/protocol';

export interface AppView {
  /** Feed a full *.topo.json document text to the canvas. */
  update(text: string): void;
}

export interface MountOptions {
  /** UI language (webview strings), default 'en'. */
  locale?: string;
  /**
   * Receives every message the canvas sends outward (ready, edit,
   * save-image, …). The bridge decides what to do with them — phase 1 is
   * read-only, so edits are dropped there (#29).
   */
  onMessage?: (message: WebviewToHostMessage) => void;
}

export function mountAppView(root: HTMLElement, options: MountOptions = {}): AppView {
  initLocale(options.locale ?? 'en');
  const host: AppHost = {
    postMessage: (message) => options.onMessage?.(message),
    // no persisted view state inside an MCP Apps iframe — every render
    // starts from the default viewport and the options in structuredContent
    getState: () => undefined,
    setState: () => {},
    staleHost: false,
    pngScale: 2,
  };
  const app = createApp(root, host);
  let docVersion = 0;
  return {
    update(text: string): void {
      docVersion += 1;
      const message: HostToWebviewMessage = {
        type: 'update',
        text,
        docVersion,
        selfOriginated: false,
      };
      app.handleMessage(message);
      app.fit(); // widgets have no saved viewport — always show everything
    },
  };
}
