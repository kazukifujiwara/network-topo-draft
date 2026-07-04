/**
 * Pure pieces of the host side of the sync loop (plan §4.2), separated from
 * the VSCode API for unit testing (plan §6.2 ⑤).
 *
 * Phase 1 is host → webview only: full text + document version on every
 * change. `selfOriginated` is always false until Phase 2 introduces webview
 * edits (and with them baseVersion checks and echo suppression).
 */
import type { ReadyMessage, UpdateMessage } from '@topodraft/protocol';

export function makeUpdateMessage(text: string, docVersion: number): UpdateMessage {
  return { type: 'update', text, docVersion, selfOriginated: false };
}

export function isReadyMessage(message: unknown): message is ReadyMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'ready'
  );
}

const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function getNonce(): string {
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
  }
  return out;
}
