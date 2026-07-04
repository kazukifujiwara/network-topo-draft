import { describe, expect, it } from 'vitest';
import { activate, deactivate } from '../src/extension';

describe('extension shell', () => {
  it('activate/deactivate exist and are callable no-ops in Phase 0', () => {
    expect(activate()).toBeUndefined();
    expect(deactivate()).toBeUndefined();
  });
});
