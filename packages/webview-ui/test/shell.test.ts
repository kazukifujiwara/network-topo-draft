import { describe, expect, it } from 'vitest';
import { NODE_W } from '@topodraft/core';
import { WEBVIEW_UI_SHELL } from '../src/index';

describe('webview-ui shell', () => {
  it('exists and can import @topodraft/core (workspace wiring)', () => {
    expect(WEBVIEW_UI_SHELL).toBe(true);
    expect(NODE_W).toBe(152);
  });
});
