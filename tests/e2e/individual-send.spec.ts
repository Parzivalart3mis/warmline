import { test, expect, skipUnlessConfigured, signIn } from './helpers';

/**
 * §12 flow 1: sign in → upload a resume → add a contact → generate a draft →
 * send now → the row shows "Sent".
 */
test.describe('individual send', () => {
  test.beforeEach(skipUnlessConfigured);

  test('draft streams in, then sends, and the contact reads Sent', async ({ page }) => {
    await signIn(page);

    // Ensure a resume exists (Settings → upload).
    await page.goto('/settings');
    const uploader = page.getByLabel(/resume pdf/i);
    if (await uploader.isVisible()) {
      await uploader.setInputFiles('tests/e2e/fixtures/resume.pdf');
      await page.getByLabel(/new version label/i).fill('Backend');
      await page.getByRole('button', { name: /upload resume/i }).click();
      await expect(page.getByText(/uploaded and text extracted/i)).toBeVisible();
    }

    // Add a contact (to one of the operator's own addresses).
    await page.goto('/contacts');
    await page.getByRole('button', { name: /add contact/i }).click();
    await page.getByLabel('First name').fill('Test');
    await page.getByLabel('Email').fill(process.env.E2E_CLERK_USER_EMAIL!);
    await page.getByLabel('Company').fill('Warmline QA');
    await page.getByLabel('Role I want').fill('Backend Engineer');
    await page.getByRole('button', { name: /^add contact$/i }).click();
    await expect(page.getByText(/contact added/i)).toBeVisible();

    // Draft a new email and watch it stream.
    await page.goto('/drafts');
    await page.getByRole('button', { name: /draft a new email/i }).click();
    await page.getByRole('button', { name: /warmline qa/i }).click();
    await page.getByRole('button', { name: /generate draft/i }).click();

    // Body arrives (serif letter) — assert it becomes non-empty.
    const body = page.getByLabel('Body');
    await expect(body).not.toHaveValue('', { timeout: 30_000 });

    await page.getByRole('button', { name: /send now/i }).click();
    await expect(page.getByText(/^sent$/i)).toBeVisible({ timeout: 20_000 });

    // The contact row now reads Sent.
    await page.goto('/contacts');
    await expect(
      page.getByText('Test Warmline QA').or(page.getByText('Warmline QA')),
    ).toBeVisible();
    await expect(page.getByText('Sent').first()).toBeVisible();
  });
});
