import { defineConfig } from 'vitest/config';

// A single `npm test` at the root runs every test in every package (plan §6.1).
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts'],
    // Coverage thresholds apply to the core package only (plan §6.3, target
    // ~80%); UI/integration packages are reviewed for scenario coverage
    // instead. Run via `npm run test:coverage`.
    coverage: {
      include: ['packages/core/src/**/*.ts'],
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 90,
        branches: 80,
      },
    },
  },
});
