import { defineConfig } from 'vitest/config';

// A single `npm test` at the root runs every test in every package (plan §6.1).
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts'],
  },
});
