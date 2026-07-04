/**
 * Normalize a user-chosen save path so the topology editor, schema, and
 * diagnostics all apply. Native save dialogs (macOS in particular) handle
 * compound extensions like ".topo.json" unreliably — instead of trusting
 * the dialog, the path is corrected after the fact.
 */
export function ensureTopoJsonPath(path: string): string {
  if (path.endsWith('.topo.json')) return path;
  if (path.endsWith('.json')) return path.slice(0, -'.json'.length) + '.topo.json';
  return path + '.topo.json';
}

/**
 * Whether a path is claimed by the topology editor. The customEditors glob
 * `*.topo.json` also matches a bare `topo.json` (a `*` may match nothing),
 * so diagnostics and commands must agree with it.
 */
export function isTopoPath(path: string): boolean {
  return path.endsWith('.topo.json') || path === 'topo.json' || path.endsWith('/topo.json');
}
