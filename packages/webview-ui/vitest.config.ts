import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'webview-ui',
    include: ['test/**/*.test.ts'],
    environment: 'jsdom',
  },
});
