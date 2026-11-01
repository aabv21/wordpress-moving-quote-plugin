import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/stack/**/*.test.ts'],
    // The Compose stack is one shared instance, not a fresh one per test file, so test files
    // must run one after another instead of racing each other against its state.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    globalSetup: ['tests/stack/global-setup.ts'],
  },
});
