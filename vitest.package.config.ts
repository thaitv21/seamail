import { defineConfig } from 'vitest/config';

/** Smoke test of the packaged Windows layout; see tests/package/layout.test.ts. */
export default defineConfig({
  test: {
    include: ['tests/package/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
