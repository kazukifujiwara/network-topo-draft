/**
 * Publishes core validate() results to the Problems panel (plan §4.6) for
 * every open *.topo.json document — the feedback loop agents use to
 * self-correct (Phase 3 exit criterion).
 */
import * as vscode from 'vscode';
import { computeOffsetDiagnostics } from './diagnostics';
import { activeTopoUri, isTopoDocument } from './activeDocument';

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
} as const;

const DEBOUNCE_MS = 300;

export interface DiagnosticsHandle extends vscode.Disposable {
  /** Re-validate now; returns the problem count, or null without a target. */
  validateActive(): number | null;
}

export function registerDiagnostics(): DiagnosticsHandle {
  const collection = vscode.languages.createDiagnosticCollection('topodraft');
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const refresh = (document: vscode.TextDocument): number => {
    const diagnostics = computeOffsetDiagnostics(document.getText()).map((d) => {
      const range = new vscode.Range(
        document.positionAt(d.start),
        document.positionAt(d.start + d.length),
      );
      const diagnostic = new vscode.Diagnostic(range, d.message, SEVERITY[d.severity]);
      diagnostic.source = 'topodraft';
      diagnostic.code = d.code;
      return diagnostic;
    });
    collection.set(document.uri, diagnostics);
    return diagnostics.length;
  };

  const schedule = (document: vscode.TextDocument): void => {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        refresh(document);
      }, DEBOUNCE_MS),
    );
  };

  const subscriptions = [
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (isTopoDocument(doc)) refresh(doc);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isTopoDocument(e.document)) schedule(e.document);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      collection.delete(doc.uri);
      const key = doc.uri.toString();
      clearTimeout(timers.get(key));
      timers.delete(key);
    }),
  ];
  for (const doc of vscode.workspace.textDocuments) {
    if (isTopoDocument(doc)) refresh(doc);
  }

  return {
    validateActive: () => {
      const uri = activeTopoUri();
      if (!uri) return null;
      const document = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === uri.toString(),
      );
      return document ? refresh(document) : null;
    },
    dispose: () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const s of subscriptions) s.dispose();
      collection.dispose();
    },
  };
}
