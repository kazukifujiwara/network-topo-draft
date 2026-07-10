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
}

/**
 * Mount the canvas and subscribe it to tool results. Handlers must be
 * registered before `App.connect()` — main.ts calls this first, then
 * connects.
 */
export function wireBridge(root: HTMLElement, source: ToolResultSource): AppView {
  const view = mountAppView(root, {
    onMessage: (message) => void classifyOutbound(message), // dispositions above
  });
  source.addEventListener('toolresult', (params) => {
    try {
      const { text, settings } = toolResultToUpdate(params.structuredContent);
      view.update(text, settings);
    } catch (e) {
      view.showError((e as Error).message);
    }
  });
  return view;
}
