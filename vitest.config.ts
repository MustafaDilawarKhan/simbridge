import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests sit next to the code they prove, named after requirement IDs.
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
