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
