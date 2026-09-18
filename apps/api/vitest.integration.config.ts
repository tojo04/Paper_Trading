import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
