/**
 * Semantic diagnostics with text offsets (plan §4.6): core validate()
 * produces JSON-path diagnostics; this module resolves each path to a text
 * range via jsonc-parser. Pure (no VSCode API) so it is unit-testable —
 * diagnosticsPublisher.ts does the VSCode wiring.
 *
 * The paths refer to the NORMALIZED model. For legacy inputs some canonical
 * paths do not exist in the raw text (a v3 top-level vrf expanded onto
 * endpoints, interfaces created by IP write-through, …) — resolution then
 * walks up the path to the nearest existing ancestor.
 */
import { findNodeAtLocation, parseTree } from 'jsonc-parser';
import type { Node } from 'jsonc-parser';
import { findUnknownFields, parse, validate } from '@topodraft/core';
import type { DiagnosticSeverity, Topology } from '@topodraft/core';

export interface OffsetDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  /** UTF-16 offset range into the document text */
  start: number;
  length: number;
}

function resolveNode(root: Node, path: (string | number)[]): Node {
  for (let p = [...path]; p.length; p.pop()) {
    const node = findNodeAtLocation(root, p);
    if (node) return node;
  }
  return root;
}

/**
 * Compute semantic diagnostics for a document. Returns [] when the text does
 * not parse — syntax and structural errors are the JSON language service's
 * job (schema via jsonValidation), and D11 keeps the canvas on the last good
 * state meanwhile.
 */
export function computeOffsetDiagnostics(text: string): OffsetDiagnostic[] {
  let topology: Topology;
  try {
    topology = parse(text);
  } catch {
    return [];
  }
  const semantic = validate(topology);
  // unknown fields are checked on the RAW value: parse() silently drops them,
  // and they would be lost on the next save (format spec §7)
  const unknown = findUnknownFields(JSON.parse(text));
  if (!semantic.length && !unknown.length) return [];
  const root = parseTree(text);

  const out: OffsetDiagnostic[] = unknown.map((f) => {
    const valueNode = root ? resolveNode(root, f.path) : undefined;
    // highlight the whole `"key": value` property, not just the value
    const node = valueNode?.parent?.type === 'property' ? valueNode.parent : valueNode;
    const atRoot = !node || node === root;
    return {
      severity: 'warning' as const,
      code: 'unknown-field',
      message:
        `Unknown field "${f.field}"` +
        (f.suggestion ? ` — did you mean "${f.suggestion}"?` : '') +
        ' Unknown fields are dropped when the editor saves. See the JSON Schema (topodraft.schema.json) or run "TopoDraft: Write AI Agent Guide (AGENTS.md)".',
      start: node && !atRoot ? node.offset : (root?.offset ?? 0),
      length: node && !atRoot ? node.length : 1,
    };
  });
  for (const d of semantic) {
    const node = root ? resolveNode(root, d.path) : undefined;
    // whole-document diagnostics (missing-version) mark the opening brace
    // instead of highlighting the entire file
    const atRoot = !node || node === root;
    out.push({
      severity: d.severity,
      code: d.code,
      message: d.message,
      start: node && !atRoot ? node.offset : (root?.offset ?? 0),
      length: node && !atRoot ? node.length : 1,
    });
  }
  return out;
}
