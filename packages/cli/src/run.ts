/**
 * Pure CLI logic: text in, diagnostics + formatted report out. The process
 * wiring (fs, argv, exit codes) lives in cli.ts so everything here is
 * unit-testable — the same layering as the extension's diagnostics.ts.
 *
 * Purpose (product vision): headless agents cannot read the VSCode
 * Problems panel; this gives them the exact same validation loop —
 * JSON syntax, topology shape, semantic rules, and unknown-field
 * did-you-mean suggestions — as a command.
 */
import { parseTree } from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';
import { TopoParseError, parse } from '@topodraft/core';
import { computeOffsetDiagnostics } from '../../extension/src/diagnostics';

export interface CliDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  /** 1-based */
  line: number;
  /** 1-based */
  column: number;
}

function lineCol(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      last = i;
    }
  }
  return { line, column: offset - last };
}

/** All diagnostics for one document, mirroring the editor's Problems panel. */
export function validateText(text: string): CliDiagnostic[] {
  // 1. JSON syntax — the editor delegates this to VSCode's JSON service,
  //    so the CLI must report it itself.
  const syntaxErrors: ParseError[] = [];
  parseTree(text, syntaxErrors, { allowTrailingComma: false });
  if (syntaxErrors.length) {
    return syntaxErrors.map((e) => ({
      severity: 'error' as const,
      code: 'invalid-json',
      message: 'the document is not valid JSON',
      ...lineCol(text, e.offset),
    }));
  }
  // 2. topology shape (e.g. "devices" is not an array)
  try {
    parse(text);
  } catch (e) {
    if (e instanceof TopoParseError) {
      return [
        { severity: 'error', code: 'invalid-topology', message: e.message, line: 1, column: 1 },
      ];
    }
    throw e;
  }
  // 3. semantic rules + unknown fields with did-you-mean (shared with the editor)
  return computeOffsetDiagnostics(text).map((d) => ({
    severity: d.severity,
    code: d.code,
    message: d.message,
    ...lineCol(text, d.start),
  }));
}

const ORDER = { error: 0, warning: 1, info: 2 } as const;

/** One grep-friendly line per diagnostic: `file:line:col severity code message`. */
export function formatHuman(file: string, diagnostics: CliDiagnostic[]): string {
  if (!diagnostics.length) return `${file}: OK`;
  const sorted = [...diagnostics].sort(
    (a, b) => ORDER[a.severity] - ORDER[b.severity] || a.line - b.line || a.column - b.column,
  );
  return sorted
    .map((d) => `${file}:${d.line}:${d.column} ${d.severity} ${d.code} ${d.message}`)
    .join('\n');
}

export interface CliIo {
  /** Read a file as UTF-8; throw on failure. */
  readFile(path: string): string;
  stdout(line: string): void;
  stderr(line: string): void;
}

const USAGE = `topodraft — validate TopoDraft topology files (*.topo.json / *.topo)

Usage:
  topodraft validate [--json] [--strict] <file...>

Options:
  --json     machine-readable output (one JSON object per run)
  --strict   exit non-zero on warnings too (default: errors only)

Exit codes: 0 = clean, 1 = diagnostics failed the gate, 2 = usage/IO error.`;

/** Full CLI entry, side effects injected. Returns the process exit code. */
export function runCli(argv: string[], io: CliIo, version: string): number {
  if (argv.includes('--version') || argv.includes('-v')) {
    io.stdout(version);
    return 0;
  }
  if (argv[0] !== 'validate' || argv.includes('--help') || argv.includes('-h')) {
    (argv[0] === undefined || argv.includes('--help') || argv.includes('-h')
      ? io.stdout
      : io.stderr)(USAGE);
    return argv[0] === undefined || argv.includes('--help') || argv.includes('-h') ? 0 : 2;
  }
  const rest = argv.slice(1);
  const json = rest.includes('--json');
  const strict = rest.includes('--strict');
  const files = rest.filter((a) => !a.startsWith('--'));
  const unknownFlags = rest.filter((a) => a.startsWith('--') && !['--json', '--strict'].includes(a));
  if (unknownFlags.length || !files.length) {
    io.stderr(unknownFlags.length ? `unknown option: ${unknownFlags[0]}\n${USAGE}` : USAGE);
    return 2;
  }

  const results: { file: string; diagnostics: CliDiagnostic[]; error?: string }[] = [];
  for (const file of files) {
    try {
      results.push({ file, diagnostics: validateText(io.readFile(file)) });
    } catch (e) {
      results.push({ file, diagnostics: [], error: (e as Error).message });
    }
  }

  if (json) {
    io.stdout(JSON.stringify({ results }, null, 2));
  } else {
    for (const r of results) {
      io.stdout(r.error !== undefined ? `${r.file}: cannot read (${r.error})` : formatHuman(r.file, r.diagnostics));
    }
  }

  if (results.some((r) => r.error !== undefined)) return 2;
  const failing = results.some((r) =>
    r.diagnostics.some((d) => d.severity === 'error' || (strict && d.severity === 'warning')),
  );
  return failing ? 1 : 0;
}
