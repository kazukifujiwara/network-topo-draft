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
