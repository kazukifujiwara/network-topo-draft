/**
 * Normalize a user-chosen save path so the topology editor, schema, and
 * diagnostics all apply. Native save dialogs (macOS in particular) handle
 * compound extensions like ".topo.json" unreliably — instead of trusting
 * the dialog, the path is corrected after the fact. The dedicated `.topo`
 * alias is kept as chosen; everything else normalizes to `.topo.json`.
 */
export function ensureTopoJsonPath(path: string): string {
  if (path.endsWith('.topo.json') || path.endsWith('.topo')) return path;
  if (path.endsWith('.json')) return path.slice(0, -'.json'.length) + '.topo.json';
  return path + '.topo.json';
}

/**
 * Whether a path is claimed by the topology editor. The customEditors globs
 * `*.topo.json` / `*.topo` also match a bare `topo.json` / `.topo` (a `*`
 * may match nothing), so diagnostics and commands must agree with them.
 */
export function isTopoPath(path: string): boolean {
  if (path.endsWith('.topo.json') || path.endsWith('.topo')) return true;
  return path === 'topo.json' || path.endsWith('/topo.json');
}

/**
 * How a `topodraft.templatesFolder` setting value should be resolved.
 * - 'uri': a full URI with a scheme (e.g. vscode-vfs://github/o/r/tpl) —
 *   required on virtual workspaces, where file-system paths cannot resolve
 * - 'absolute-path': an absolute file-system path (POSIX or Windows drive)
 * - 'relative': joined onto the first workspace folder (any scheme)
 *
 * A Windows drive spec ("C:\tpl", "C:/tpl") is NOT a URI: schemes here
 * require at least two characters and the "://" separator.
 */
export function templatesFolderKind(value: string): 'uri' | 'absolute-path' | 'relative' {
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(value)) return 'uri';
  if (/^(\/|[a-zA-Z]:[\\/])/.test(value)) return 'absolute-path';
  return 'relative';
}

