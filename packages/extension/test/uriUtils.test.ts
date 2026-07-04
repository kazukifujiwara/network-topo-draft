import { describe, expect, it } from 'vitest';
import { ensureTopoJsonPath } from '../src/uriUtils';

describe('ensureTopoJsonPath', () => {
  it('keeps already-correct paths untouched', () => {
    expect(ensureTopoJsonPath('/ws/new.topo.json')).toBe('/ws/new.topo.json');
  });

  it('upgrades a plain .json suffix (native dialogs mangle compound extensions)', () => {
    expect(ensureTopoJsonPath('/ws/new.json')).toBe('/ws/new.topo.json');
  });

  it('appends the full extension when none matches', () => {
    expect(ensureTopoJsonPath('/ws/new')).toBe('/ws/new.topo.json');
    expect(ensureTopoJsonPath('/ws/new.topo')).toBe('/ws/new.topo.topo.json');
  });
});
