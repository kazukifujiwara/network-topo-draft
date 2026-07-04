/**
 * Contract between the editor coordinator (app.ts) and the UI modules
 * (panel, context menu, modal, palette). All mutations flow through
 * mutate/commit/apply so the sync loop stays in one place:
 *
 * - mutate(fn): change the local working model + re-render the canvas.
 *   Used for keystroke-level edits and drags — nothing is sent yet.
 * - commit(): serialize the working model and send it to the host as an
 *   edit request (v7's pushHistory moments — plan §4.2-5).
 * - apply(op): replace the model via a pure core operation, re-render
 *   everything, and commit. Used for rename/delete/paste/convert etc.
 */
import type { Point, Topology } from '@topodraft/core';
import type { ViewOptions } from './scene';

export type LinkCollection = 'cables' | 'circuits' | 'logical_links';

export interface LinkRef {
  col: LinkCollection;
  idx: number;
}

export const linkRefKey = (ref: LinkRef): string => `${ref.col}:${ref.idx}`;

export function parseLinkRefKey(key: string): LinkRef | null {
  const m = /^(cables|circuits|logical_links):(\d+)$/.exec(key);
  return m ? { col: m[1] as LinkCollection, idx: Number(m[2]) } : null;
}

export type InlineRenameTarget =
  | { type: 'node'; name: string }
  | { type: 'site'; site: string };

export interface EditorApi {
  /** The local working model. Only call when editable() is true. */
  model(): Topology;
  editable(): boolean;
  view(): ViewOptions;

  selectedNodes(): ReadonlySet<string>;
  selectedLink(): LinkRef | null;
  selectOnly(name: string): void;
  toggleSelect(name: string): void;
  setSelection(names: string[]): void;
  selectLink(ref: LinkRef | null): void;
  clearSelection(): void;
  selectAll(): void;

  mutate(fn: (t: Topology) => void): void;
  commit(): void;
  apply(op: (t: Topology) => Topology): void;
  /** Rename a node with reference-following (ADR D10), keeping it selected. */
  renameNode(oldName: string, newName: string): void;
  renameSite(oldSite: string, newSite: string): void;

  render(): void;
  renderPanel(): void;
  toWorld(clientX: number, clientY: number): Point;

  copySelection(): boolean;
  pasteClipboard(at?: Point): void;
  duplicateSelection(): void;
  hasClipboard(): boolean;
  deleteSelection(): void;
  addNodeAt(role: string, wx: number, wy: number): void;
  clearCanvas(): void;
  arrange(kind: 'row' | 'col' | 'dh' | 'dv'): void;

  openConfigContext(deviceName: string): void;
  openInlineRename(target: InlineRenameTarget): void;
  toast(message: string): void;
}
