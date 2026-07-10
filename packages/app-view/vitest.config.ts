import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'app-view',
    include: ['test/**/*.test.ts'],
    environment: 'jsdom',
  },
});
