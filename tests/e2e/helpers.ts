import { test as base, type Page } from '@playwright/test';

/**
 * E2E requires a deployed target with real Clerk test credentials. When those
 * env vars are absent (local dev, PR CI without secrets), every spec skips
 * rather than failing — the suite is opt-in via env.
 */
const REQUIRED = ['E2E_BASE_URL', 'E2E_CLERK_USER_EMAIL', 'E2E_CLERK_USER_PASSWORD'] as const;

export const e2eConfigured = REQUIRED.every((k) => !!process.env[k]);

export const test = base;
export { expect } from '@playwright/test';

export function skipUnlessConfigured() {
  test.skip(
    !e2eConfigured,
    `E2E disabled — set ${REQUIRED.join(', ')} to run against a deployed target.`,
  );
}

/** Sign in through Clerk's hosted form using the test credentials. */
export async function signIn(page: Page) {
  await page.goto('/');
  await page
    .getByRole('button', { name: /sign in/i })
    .first()
    .click();
  await page.getByLabel(/email/i).fill(process.env.E2E_CLERK_USER_EMAIL!);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByLabel(/password/i).fill(process.env.E2E_CLERK_USER_PASSWORD!);
  await page.getByRole('button', { name: /continue|sign in/i }).click();
  await page.waitForURL(/\/queue/, { timeout: 20_000 });
}
