import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    setupFiles: [],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@apex/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
});
