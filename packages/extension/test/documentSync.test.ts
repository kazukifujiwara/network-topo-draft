/**
 * Protocol contract tests (plan §6.2 ⑤): baseVersion-mismatch discard and
 * echo suppression, against a fake document host.
 */
import { describe, expect, it } from 'vitest';
import type { UpdateMessage } from '@topodraft/protocol';
import { DocumentSyncController, isEditMessage } from '../src/documentSync';

/** Minimal TextDocument stand-in: version bumps on every applied edit. */
function fakeDoc(initial = 'v0', options?: { rejectEdits?: boolean; syncChangeEvent?: boolean }) {
  const posted: UpdateMessage[] = [];
  const state = { text: initial, version: 1 };
  const host = {
    getText: () => state.text,
    getVersion: () => state.version,
    applyFullTextEdit: (newText: string): Thenable<boolean> => {
      if (options?.rejectEdits) return Promise.resolve(false);
      state.text = newText;
      state.version++;
      // VSCode fires onDidChangeTextDocument before applyEdit resolves
      controller.handleDocumentChanged();
      return Promise.resolve(true);
    },
    postToWebview: (m: UpdateMessage) => posted.push(m),
  };
  // declared after `host` — the applyFullTextEdit closure only runs later
  const controller = new DocumentSyncController(host);
  /** an external (agent) edit arriving through the text editor */
  const agentEdit = (text: string): void => {
    state.text = text;
    state.version++;
    controller.handleDocumentChanged();
  };
  return { controller, posted, state, agentEdit };
}

describe('ready handshake', () => {
  it('replies with the current text and version, not self-originated', () => {
    const f = fakeDoc('hello');
    f.controller.handleReady();
    expect(f.posted).toEqual([
      { type: 'update', text: 'hello', docVersion: 1, selfOriginated: false },
    ]);
  });
});

describe('webview edits (plan §4.2-2)', () => {
  it('applies an edit whose baseVersion matches and reports the change as self-originated', async () => {
    const f = fakeDoc('old');
    const outcome = await f.controller.handleEdit({ type: 'edit', text: 'new', baseVersion: 1 });
    expect(outcome).toBe('applied');
    expect(f.state.text).toBe('new');
    expect(f.posted).toEqual([
      { type: 'update', text: 'new', docVersion: 2, selfOriginated: true },
    ]);
  });

  it('DISCARDS an edit computed against a stale version (agent race)', async () => {
    const f = fakeDoc('old');
    f.agentEdit('agent-change'); // version 2, update posted
    const outcome = await f.controller.handleEdit({
      type: 'edit',
      text: 'stale-canvas-state',
      baseVersion: 1,
    });
    expect(outcome).toBe('discarded-stale');
    expect(f.state.text).toBe('agent-change'); // agent edit survives untouched
    expect(f.posted).toHaveLength(1);
    expect(f.posted[0]?.selfOriginated).toBe(false);
  });

  it('skips no-op edits without touching the document version', async () => {
    const f = fakeDoc('same');
    const outcome = await f.controller.handleEdit({ type: 'edit', text: 'same', baseVersion: 1 });
    expect(outcome).toBe('no-op');
    expect(f.state.version).toBe(1);
    expect(f.posted).toEqual([]);
  });

  it('reports rejection when VSCode refuses the WorkspaceEdit', async () => {
    const f = fakeDoc('old', { rejectEdits: true });
    const outcome = await f.controller.handleEdit({ type: 'edit', text: 'new', baseVersion: 1 });
    expect(outcome).toBe('rejected');
  });
});

describe('echo suppression (plan §4.2-3)', () => {
  it('external changes are never flagged self-originated, before or after own edits', async () => {
    const f = fakeDoc('a');
    f.agentEdit('b');
    await f.controller.handleEdit({ type: 'edit', text: 'c', baseVersion: 2 });
    f.agentEdit('d');
    expect(f.posted.map((m) => m.selfOriginated)).toEqual([false, true, false]);
  });
});

describe('isEditMessage', () => {
  it('accepts only well-formed edit messages', () => {
    expect(isEditMessage({ type: 'edit', text: 'x', baseVersion: 3 })).toBe(true);
    expect(isEditMessage({ type: 'edit', text: 'x' })).toBe(false);
    expect(isEditMessage({ type: 'ready' })).toBe(false);
    expect(isEditMessage(null)).toBe(false);
  });
});
