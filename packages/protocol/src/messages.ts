/**
 * Webview ⇔ extension-host message contract (plan §4.2).
 *
 * Phase 0 ships types only. Runtime helpers (type guards, the
 * baseVersion-mismatch/echo-suppression logic tested as pure functions,
 * plan §6.2 ⑤) arrive with Phase 1.
 */

/** Host → Webview: the text document changed (or initial load). */
export interface UpdateMessage {
  type: 'update';
  /** Full text of the `.topo.json` document — the source of truth (ADR D1). */
  text: string;
  /** `TextDocument.version` this text corresponds to. */
  docVersion: number;
  /**
   * True when the change originated from this webview's own edit request
   * (echo suppression, plan §4.2-3): the webview then preserves selection
   * and viewport instead of resetting them.
   */
  selfOriginated: boolean;
}

/** Webview → Host: request to replace the document with new serialized text. */
export interface EditMessage {
  type: 'edit';
  /** Full canonical `serialize()` output. */
  text: string;
  /**
   * Document version the edit was computed against. The host applies the
   * edit only if this matches the current document version; otherwise the
   * edit is discarded (plan §4.2-2, stale-state overwrite prevention).
   */
  baseVersion: number;
}

/** Webview → Host: the webview finished loading and requests the initial update. */
export interface ReadyMessage {
  type: 'ready';
}

/** The four v7 Export tabs that survive as commands (plan §4.4, ADR D2). */
export type ExportKind = 'markdown' | 'for-ai' | 'schema' | 'drawio';

/**
 * Webview → Host: the toolbar Export menu was used; the host runs the
 * corresponding export command against this editor's document.
 */
export interface ExportRequestMessage {
  type: 'export';
  kind: ExportKind;
}

/**
 * Webview → Host: the toolbar's AI-guide dialog was confirmed; the host
 * writes the agent guide (AGENTS.md) into the workspace.
 */
export interface AgentGuideRequestMessage {
  type: 'agent-guide';
  /** true → the host asks for a target file instead of writing AGENTS.md */
  saveAs?: boolean;
}

/**
 * Webview → Host: the toolbar's New button was pressed; the host runs the
 * New Topology File command (template QuickPick → save dialog → open).
 */
export interface NewFileRequestMessage {
  type: 'new-file';
}

export type HostToWebviewMessage = UpdateMessage;
export type WebviewToHostMessage =
  | EditMessage
  | ReadyMessage
  | ExportRequestMessage
  | AgentGuideRequestMessage
  | NewFileRequestMessage;
