/**
 * packages/core must stay browser-compatible — no DOM, no Node APIs
 * (plan §9: vscode.dev support; acceptance criterion of Phase 0).
 *
 * Three layers enforce this: tsconfig.src.json compiles src/ with
 * lib: ["ES2020"] and types: [], eslint bans the globals/imports, and this
 * test asserts every import in src/ is relative (core has zero runtime
 * dependencies) and no restricted global identifiers appear.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers';

const SRC = resolve(REPO_ROOT, 'packages/core/src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => resolve(e.parentPath, e.name));
}

const files = sourceFiles(SRC);

describe('core browser purity', () => {
  it('finds the core sources', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('every import/export specifier is relative — zero external dependencies', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const specifiers = [...text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map(
        (m) => m[1] as string,
      );
      for (const spec of specifiers) {
        expect(spec.startsWith('.'), `${file} imports non-relative module "${spec}"`).toBe(true);
      }
    }
  });

  it('no DOM or Node global identifiers appear in core code (comments/strings excluded)', () => {
    const banned =
      /\b(document|window|localStorage|sessionStorage|XMLHttpRequest|require|process\.env|Buffer|__dirname|__filename|structuredClone)\b/;
    // Strings and comments are data/prose, not identifier usage — identifier
    // usage is additionally blocked at compile time (lib: ["ES2020"], types: [])
    // and by eslint no-restricted-globals.
    const stripNonCode = (text: string): string =>
      text
        .replace(/`(?:[^`\\]|\\[\s\S])*`/g, '``')
        .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
        .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
    for (const file of files) {
      const code = stripNonCode(readFileSync(file, 'utf8'));
      const match = banned.exec(code);
      expect(match, `${file} references "${match?.[0]}"`).toBeNull();
    }
  });
});
