import { describe, expect, it } from 'vitest';
import { getNonce, isReadyMessage, makeUpdateMessage } from '../src/sync';

describe('makeUpdateMessage', () => {
  it('carries full text + document version, never self-originated in Phase 1', () => {
    expect(makeUpdateMessage('{"version":1,"devices":[]}', 7)).toEqual({
      type: 'update',
      text: '{"version":1,"devices":[]}',
      docVersion: 7,
      selfOriginated: false,
    });
  });
});

describe('isReadyMessage', () => {
  it('accepts only { type: "ready" } shapes', () => {
    expect(isReadyMessage({ type: 'ready' })).toBe(true);
    expect(isReadyMessage({ type: 'edit', text: '', baseVersion: 0 })).toBe(false);
    expect(isReadyMessage(null)).toBe(false);
    expect(isReadyMessage('ready')).toBe(false);
    expect(isReadyMessage({})).toBe(false);
  });
});

describe('getNonce', () => {
  it('produces 32 alphanumeric chars, different each call', () => {
    const a = getNonce();
    const b = getNonce();
    expect(a).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(a).not.toBe(b);
  });
});
