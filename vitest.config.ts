import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
    // PGlite's WASM migration is slow under v8 coverage instrumentation; give
    // the per-file DB setup room so coverage runs don't flake on the hook.
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['lib/**'],
      exclude: [
        'lib/db/**', // driver wiring; exercised by every integration test
        'lib/api-client.ts', // browser fetch/SWR wrapper
        'lib/types.ts', // types + trivial helper
        'lib/utils.ts', // cn() tailwind-merge one-liner
        'lib/auth.ts', // Clerk-coupled server auth
        'lib/ratelimit.ts', // Upstash-coupled
        'lib/ai/models.ts', // thin google() model wrappers
        'lib/mail/index.ts', // env-based sender selection (returns live SMTP)
        'lib/engine/start-run.ts', // workflow-SDK start() glue
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
});
