import { describe, expect, it } from 'vitest';
import { ensureTopoJsonPath, isTopoPath, templatesFolderKind } from '../src/uriUtils';

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

describe('templatesFolderKind (#3: templatesFolder on virtual workspaces)', () => {
  it('classifies full URIs so virtual-workspace folders can be configured', () => {
    expect(templatesFolderKind('vscode-vfs://github/user/repo/tpl')).toBe('uri');
    expect(templatesFolderKind('file:///Users/me/templates')).toBe('uri');
    expect(templatesFolderKind('untitled://x')).toBe('uri');
  });

  it('keeps absolute file-system paths as paths (POSIX and Windows)', () => {
    expect(templatesFolderKind('/Users/me/templates')).toBe('absolute-path');
    expect(templatesFolderKind('C:\\templates')).toBe('absolute-path');
    // a Windows drive with forward slash is a path, not a one-letter scheme
    expect(templatesFolderKind('C:/templates')).toBe('absolute-path');
  });

  it('everything else stays workspace-relative (the default)', () => {
    expect(templatesFolderKind('.topodraft/templates')).toBe('relative');
    expect(templatesFolderKind('templates')).toBe('relative');
    expect(templatesFolderKind('')).toBe('relative');
  });
});

