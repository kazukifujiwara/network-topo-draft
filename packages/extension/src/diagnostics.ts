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
import { parse, validate } from '@topodraft/core';
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
  const diagnostics = validate(topology);
  if (!diagnostics.length) return [];
  const root = parseTree(text);
  return diagnostics.map((d) => {
    const node = root ? resolveNode(root, d.path) : undefined;
    // whole-document diagnostics (missing-version) mark the opening brace
    // instead of highlighting the entire file
    const atRoot = !node || node === root;
    return {
      severity: d.severity,
      code: d.code,
      message: d.message,
      start: node && !atRoot ? node.offset : (root?.offset ?? 0),
      length: node && !atRoot ? node.length : 1,
    };
  });
}
