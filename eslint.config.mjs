import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-e2e/**',
      '**/dist-web/**',
      '**/.build/**',
      '**/.vscode-test/**',
      '**/.vscode-test-web/**',
      'reference/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // packages/core must stay browser-compatible (no DOM, no Node APIs) so the
    // extension can target vscode.dev (plan §9, ADR D8). Enforced here and by a
    // dedicated test in packages/core/test/purity.test.ts.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'localStorage',
        'sessionStorage',
        'XMLHttpRequest',
        'fetch',
        'process',
        'Buffer',
        '__dirname',
        '__filename',
        'require',
        'setImmediate',
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'http',
            'https', 'net', 'os', 'path', 'stream', 'tls', 'url', 'util',
            'worker_threads', 'zlib',
          ],
          patterns: [
            {
              group: ['node:*'],
              message: 'packages/core must stay browser-compatible (plan §9): no Node APIs.',
            },
          ],
        },
      ],
    },
  },
);
