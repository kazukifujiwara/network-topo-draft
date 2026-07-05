import { describe, expect, it } from 'vitest';
import { ensureTopoJsonPath, isTopoPath } from '../src/uriUtils';

describe('isTopoPath', () => {
  it('matches everything the customEditors glob *.topo.json claims', () => {
    expect(isTopoPath('/ws/a.topo.json')).toBe(true);
    expect(isTopoPath('/ws/topo.json')).toBe(true); // `*` may match nothing
    expect(isTopoPath('topo.json')).toBe(true);
    expect(isTopoPath('/ws/a.json')).toBe(false);
    expect(isTopoPath('/ws/mytopo.json')).toBe(false);
  });

  it('matches the dedicated *.topo alias too', () => {
    expect(isTopoPath('/ws/a.topo')).toBe(true);
    expect(isTopoPath('/ws/a copy.topo')).toBe(true); // finder copies stay claimed
    expect(isTopoPath('/ws/a.topology')).toBe(false);
  });
});

describe('ensureTopoJsonPath', () => {
  it('keeps already-correct paths untouched (both extensions)', () => {
    expect(ensureTopoJsonPath('/ws/new.topo.json')).toBe('/ws/new.topo.json');
    expect(ensureTopoJsonPath('/ws/new.topo')).toBe('/ws/new.topo'); // alias kept as chosen
  });

  it('upgrades a plain .json suffix (native dialogs mangle compound extensions)', () => {
    expect(ensureTopoJsonPath('/ws/new.json')).toBe('/ws/new.topo.json');
  });

  it('appends the full extension when none matches', () => {
    expect(ensureTopoJsonPath('/ws/new')).toBe('/ws/new.topo.json');
  });
});
