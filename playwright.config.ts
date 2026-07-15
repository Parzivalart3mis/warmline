import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against a deployed target (Vercel preview) or a local server.
 * Set E2E_BASE_URL plus the Clerk test creds to enable the specs; without
 * them the suite skips cleanly (see the guard in tests/e2e/*.spec.ts).
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    // iPhone is the primary device and the only one that must be perfect.
    viewport: { width: 393, height: 852 },
  },
  projects: [
    {
      name: 'iphone',
      use: { ...devices['iPhone 15 Pro'] },
    },
  ],
});
