/**
 * Mounting seam for the MCP Apps widget (#28/#29): renders the TopoDraft
 * canvas from a plain DOM root with an injected AppHost — no
 * acquireVsCodeApi, no VSCode. The MCP Apps bridge (bridge.ts) constructs
 * the host side and feeds updates through the returned handle; this module
 * stays transport-agnostic so tests can drive it directly.
 */
import type { AppHost, PersistedViewState, ViewMode } from '@topodraft/webview-ui';
import { createApp, initLocale } from '@topodraft/webview-ui';
import type { HostToWebviewMessage, WebviewToHostMessage } from '@topodraft/protocol';
import { allVrfs, parse } from '@topodraft/core';

/** The view toggles a render carries (mirrors the render tool's inputs). */
export interface ViewSettings {
  view: ViewMode;
  underlay: boolean;
  /**
   * Logical view: the VRFs to draw ('' = the global row), #46; undefined =
   * no filter. The canvas keeps the complementary HIDDEN set, computed
   * against the rendered topology on every update.
   */
  vrfs?: readonly string[];
}

export const DEFAULT_SETTINGS: ViewSettings = {
  view: 'physical',
  underlay: true,
};

export interface AppView {
  /**
   * Feed a full *.topo.json document text to the canvas. When `settings`
   * differ from the current ones the canvas is re-created with the new
   * view state (widgets have no saved viewport — every update re-fits).
   */
  update(text: string, settings?: ViewSettings): void;
  /** Re-fit the viewport to the content (container size changed, #32). */
  refit(): void;
  /** Surface a bridge-level problem in the canvas's own error bar (D11 UI). */
  showError(message: string): void;
}

export interface MountOptions {
  /** UI language (webview strings), default 'en'. */
  locale?: string;
  /**
   * Receives every message the canvas sends outward (ready, edit,
   * save-image, …). The bridge decides what to do with them — phase 1 is
   * read-only, so edits are dropped there (bridge.ts).
   */
  onMessage?: (message: WebviewToHostMessage) => void;
}

export function mountAppView(root: HTMLElement, options: MountOptions = {}): AppView {
  initLocale(options.locale ?? 'en');
  let settings: ViewSettings = { ...DEFAULT_SETTINGS };
  let hiddenVrfs: string[] = [];
  const host: AppHost = {
    postMessage: (message) => options.onMessage?.(message),
    // the "persisted" state is derived from the current render's settings —
    // an MCP Apps iframe has no state of its own to restore
    getState: (): PersistedViewState => ({
      vt: { x: 60, y: 40, k: 1 },
      viewMode: settings.view,
      underlayOn: settings.underlay,
      hiddenVrfs,
      gridOn: true,
      snapOn: true,
      panelCollapsed: true,
    }),
    setState: () => {},
    staleHost: false,
    pngScale: 2,
  };
  let app = createApp(root, host);
  let docVersion = 0;

  const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
    a === b || (a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => v === b[i]));
  const sameSettings = (a: ViewSettings, b: ViewSettings): boolean =>
    a.view === b.view && a.underlay === b.underlay && sameList(a.vrfs, b.vrfs);
  /** The canvas hides what the render's VRF list leaves out. */
  const hiddenFor = (text: string, vrfs: readonly string[] | undefined): string[] => {
    if (!vrfs) return [];
    try {
      return ['', ...allVrfs(parse(text))].filter((v) => !vrfs.includes(v));
    } catch {
      return []; // unparsable text — the canvas shows its own D11 error
    }
  };

  return {
    update(text: string, next?: ViewSettings): void {
      const hidden = hiddenFor(text, (next ?? settings).vrfs);
      if ((next && !sameSettings(settings, next)) || !sameList(hidden, hiddenVrfs)) {
        if (next) settings = { ...next };
        hiddenVrfs = hidden;
        root.textContent = '';
        app = createApp(root, host); // re-created with the new view state
        docVersion = 0;
      }
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
    refit(): void {
      app.fit();
    },
    showError(message: string): void {
      app.dom.errorBar.style.display = 'flex';
      app.dom.errorMsg.textContent = message;
    },
  };
}
