/**
 * Host side of the sync loop (plan §4.2), separated from the VSCode API so
 * the baseVersion-mismatch and echo-suppression logic is unit-testable
 * (plan §6.2 ⑤).
 *
 * - Webview → host edits carry the docVersion they were computed against.
 *   The edit is applied as a full-text replacement ONLY if that version is
 *   still current; otherwise it is discarded and the webview follows the
 *   newer update instead (prevents stale-canvas overwrites racing an agent).
 * - Updates caused by our own applied edit are flagged selfOriginated so the
 *   webview can suppress the echo (it is already showing that state).
 */
import type {
  AgentGuideRequestMessage,
  NewFileRequestMessage,
  EditMessage,
  ExportRequestMessage,
  ReadyMessage,
  UpdateMessage,
} from '@topodraft/protocol';

const EXPORT_KINDS = ['markdown', 'for-ai', 'schema', 'drawio'];

export function isExportRequest(message: unknown): message is ExportRequestMessage {
  const m = message as { type?: unknown; kind?: unknown } | null;
  return (
    typeof message === 'object' &&
    message !== null &&
    m?.type === 'export' &&
    typeof m.kind === 'string' &&
    EXPORT_KINDS.includes(m.kind)
  );
}

export interface DocumentHost {
  getText(): string;
  getVersion(): number;
  /** Replace the entire document text; resolves false when VSCode rejected it. */
  applyFullTextEdit(newText: string): Thenable<boolean>;
  postToWebview(message: UpdateMessage): void;
}

export type EditOutcome = 'applied' | 'discarded-stale' | 'rejected' | 'no-op';

export function isEditMessage(message: unknown): message is EditMessage {
  const m = message as { type?: unknown; text?: unknown; baseVersion?: unknown } | null;
  return (
    typeof message === 'object' &&
    message !== null &&
    m?.type === 'edit' &&
    typeof m.text === 'string' &&
    typeof m.baseVersion === 'number'
  );
}

export function isAgentGuideRequest(message: unknown): message is AgentGuideRequestMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'agent-guide'
  );
}

export function isNewFileRequest(message: unknown): message is NewFileRequestMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'new-file'
  );
}

export function isReadyMessage(message: unknown): message is ReadyMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'ready'
  );
}

export class DocumentSyncController {
  private selfEditsInFlight = 0;

  public constructor(private readonly host: DocumentHost) {}

  /** Call from onDidChangeTextDocument for this document. */
  public handleDocumentChanged(): void {
    this.host.postToWebview({
      type: 'update',
      text: this.host.getText(),
      docVersion: this.host.getVersion(),
      selfOriginated: this.selfEditsInFlight > 0,
    });
  }

  /** Call when the webview signals it is ready (initial load / restore). */
  public handleReady(): void {
    this.host.postToWebview({
      type: 'update',
      text: this.host.getText(),
      docVersion: this.host.getVersion(),
      selfOriginated: false,
    });
  }

  /** Apply a webview edit request per plan §4.2-2. */
  public async handleEdit(edit: EditMessage): Promise<EditOutcome> {
    if (edit.baseVersion !== this.host.getVersion()) {
      // Stale: an agent (or another view) changed the document after the
      // canvas operation was computed. The change event for that newer
      // version has already produced an update, so just drop this edit.
      return 'discarded-stale';
    }
    if (edit.text === this.host.getText()) return 'no-op';
    this.selfEditsInFlight++;
    try {
      const ok = await this.host.applyFullTextEdit(edit.text);
      return ok ? 'applied' : 'rejected';
    } finally {
      this.selfEditsInFlight--;
    }
  }
}
