/**
 * MCP Apps bridge (#29): binds the ext-apps `App` client to the canvas
 * mounted by mount.ts. The renderer never learns it lives inside an MCP
 * App — an inbound `ui/notifications/tool-result` becomes the same
 * `update` the VSCode webview receives, and outbound canvas messages are
 * dropped (phase 1 is read-only; the phase-2 seam is marked below).
 *
 * The wiring takes a minimal structural slice of `App` so tests can drive
 * the full loop with a fake — only main.ts touches the real class.
 */
import type { WebviewToHostMessage } from '@topodraft/protocol';
import type { AppView, ViewSettings } from './mount';
import { DEFAULT_SETTINGS, mountAppView } from './mount';

/**
 * structuredContent contract shared with the server (#30): the render tool
 * delivers the canonical topology plus the view toggles it was called with.
 * Field names mirror the tool's input schema (snake_case).
 */
export interface RenderPayload {
  topology: Record<string, unknown>;
  view?: 'physical' | 'logical';
  show_global?: boolean;
  underlay?: boolean;
}

export interface UpdateFromToolResult {
  /** Document text for the canvas (the topology, serialized verbatim). */
  text: string;
  settings: ViewSettings;
}

/** Pure: tool-result `structuredContent` → canvas update. Throws on junk. */
export function toolResultToUpdate(structuredContent: unknown): UpdateFromToolResult {
  const sc = structuredContent as Partial<RenderPayload> | null | undefined;
  if (sc === null || typeof sc !== 'object' || typeof sc.topology !== 'object' || sc.topology === null) {
    throw new Error(
      'tool result carries no topology — expected structuredContent.topology (canonical *.topo.json value)',
    );
  }
  return {
    text: JSON.stringify(sc.topology),
    settings: {
      view: sc.view === 'logical' ? 'logical' : DEFAULT_SETTINGS.view,
      showGlobal: sc.show_global !== false,
      underlay: sc.underlay !== false,
    },
  };
}

export type OutboundDisposition =
  /** Canvas edit — PHASE-2 SEAM (#25): will become tools/call on the edit tools. */
  | 'dropped-readonly'
  /** Startup chatter (ready, list-templates) — nothing to answer in a widget. */
  | 'ignored-lifecycle'
  /** File-writing affordances (save-image, export, …) — no workspace here. */
  | 'dropped-unsupported';

/** Pure: the phase-1 outbound policy for canvas messages. */
export function classifyOutbound(message: WebviewToHostMessage): OutboundDisposition {
  switch (message.type) {
    case 'edit':
      return 'dropped-readonly';
    case 'ready':
    case 'list-templates':
      return 'ignored-lifecycle';
    default:
      return 'dropped-unsupported';
  }
}

/** The slice of the ext-apps `App` the bridge needs (fake-able in tests). */
export interface ToolResultSource {
  addEventListener(
    event: 'toolresult',
    handler: (params: { structuredContent?: Record<string, unknown> }) => void,
  ): void;
  addEventListener(
    event: 'toolinput',
    handler: (params: { arguments?: Record<string, unknown> }) => void,
  ): void;
  addEventListener(
    event: 'hostcontextchanged',
    handler: (params: HostContextPatch) => void,
  ): void;
  /** View-side tools/call — used ONLY by the recovery path (#42). */
  callServerTool?(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{ structuredContent?: Record<string, unknown>; isError?: boolean }>;
  /**
   * ui/resource-teardown handler slot (the App class resolves the request
   * after the callback). Typed loosely — the real setter takes
   * (params, extra) and our zero-arg cleanup is call-compatible.
   */
  onteardown?: unknown;
}

/** Does this payload carry a renderable topology? (pure, reused by recovery) */
export function hasTopology(structuredContent: unknown): boolean {
  const sc = structuredContent as { topology?: unknown } | null | undefined;
  return sc !== null && typeof sc === 'object' && typeof sc.topology === 'object' && sc.topology !== null;
}

/**
 * The host-context fields phase 1 reacts to (#32). Theme is DELIBERATELY
 * ignored: the canvas ships the fixed dark palette (v0.4.0 decision) — a
 * light theme is a demand-driven follow-up, and an unknown theme value
 * must never break the widget.
 */
export interface HostContextPatch {
  theme?: 'light' | 'dark';
  displayMode?: 'inline' | 'fullscreen' | 'pip';
  [key: string]: unknown;
}

export interface BridgeLifecycle {
  /** Container resized (window resize inside the iframe) → debounced refit. */
  handleResize(): void;
  /** ui/notifications/host-context-changed → refit; theme ignored (above). */
  handleHostContext(patch: HostContextPatch): void;
  /** ui/resource-teardown: stop the timers/listeners the bridge owns. */
  teardown(): void;
}

type WindowSlice = Pick<Window, 'addEventListener' | 'removeEventListener'>;

const REFIT_DEBOUNCE_MS = 100;

/** Lifecycle handlers, separated from the wiring so tests drive them directly. */
export function createLifecycle(view: Pick<AppView, 'refit'>, win: WindowSlice): BridgeLifecycle {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refitSoon = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => view.refit(), REFIT_DEBOUNCE_MS);
  };
  const lifecycle: BridgeLifecycle = {
    handleResize: refitSoon,
    handleHostContext: (patch) => {
      // any layout-affecting change (display mode, safe area, size hints)
      // gets the same answer: re-fit the diagram. Theme: see HostContextPatch.
      if (patch.theme !== undefined && Object.keys(patch).length === 1) return;
      refitSoon();
    },
    teardown: () => {
      clearTimeout(timer);
      win.removeEventListener('resize', lifecycle.handleResize);
    },
  };
  win.addEventListener('resize', lifecycle.handleResize);
  return lifecycle;
}

export interface WiredBridge {
  view: AppView;
  lifecycle: BridgeLifecycle;
}

/**
 * Mount the canvas and subscribe it to the host. Handlers must be
 * registered before `App.connect()` — main.ts calls this first, then
 * connects.
 */
export function wireBridge(
  root: HTMLElement,
  source: ToolResultSource,
  win: WindowSlice = window,
): WiredBridge {
  const view = mountAppView(root, {
    onMessage: (message) => void classifyOutbound(message), // dispositions above
  });
  const lifecycle = createLifecycle(view, win);
  // Recovery seam (#42): some hosts (observed: Claude Desktop with the
  // pre-final protocolVersion 2025-11-25) forward ui/notifications/tool-result
  // WITHOUT structuredContent even though the server returned it. The host
  // does send ui/notifications/tool-input, so we remember the arguments and,
  // when a result arrives empty, re-fetch through the view-side tools/call —
  // that direct request/response path returns the raw CallToolResult.
  // Spec-compliant hosts never trigger the extra call.
  let lastToolInput: Record<string, unknown> | undefined;
  source.addEventListener('toolinput', (params) => {
    if (params.arguments !== undefined) lastToolInput = params.arguments;
  });
  source.addEventListener('toolresult', (params) => {
    void (async () => {
      try {
        let structuredContent: unknown = params.structuredContent;
        if (!hasTopology(structuredContent) && lastToolInput && source.callServerTool) {
          const recovered = await source.callServerTool({
            name: 'render_svg',
            arguments: lastToolInput,
          });
          if (hasTopology(recovered.structuredContent)) {
            structuredContent = recovered.structuredContent;
          }
        }
        const { text, settings } = toolResultToUpdate(structuredContent);
        view.update(text, settings);
      } catch (e) {
        view.showError((e as Error).message);
      }
    })();
  });
  source.addEventListener('hostcontextchanged', (params) => lifecycle.handleHostContext(params));
  source.onteardown = () => {
    lifecycle.teardown();
    return {}; // the iframe is unmounted right after — DOM state dies with it
  };
  return { view, lifecycle };
}
