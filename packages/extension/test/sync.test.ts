import { describe, expect, it } from 'vitest';
import { getNonce } from '../src/sync';

describe('getNonce', () => {
  it('produces 32 alphanumeric chars, different each call', () => {
    const a = getNonce();
    const b = getNonce();
    expect(a).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(a).not.toBe(b);
  });
});
