import { describe, expect, it } from 'vitest';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../src/index';

describe('protocol message types', () => {
  it('describes the sync-loop messages of plan §4.2', () => {
    const update: HostToWebviewMessage = {
      type: 'update',
      text: '{"version":1,"devices":[]}',
      docVersion: 3,
      selfOriginated: false,
    };
    const edit: WebviewToHostMessage = {
      type: 'edit',
      text: '{"version":1,"devices":[]}',
      baseVersion: 3,
    };
    const ready: WebviewToHostMessage = { type: 'ready' };

    expect(update.type).toBe('update');
    expect(edit.type).toBe('edit');
    expect(ready.type).toBe('ready');
  });
});
