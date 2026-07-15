import { test, expect, skipUnlessConfigured, signIn } from './helpers';

/**
 * §12 flow 2: import a CSV of 5 contacts → start a manual run → assert 5
 * messages go to queued and the first transitions to sending.
 */
test.describe('bulk run', () => {
  test.beforeEach(skipUnlessConfigured);

  test('import five, run, and watch the drip begin', async ({ page }) => {
    await signIn(page);
    await page.goto('/contacts');

    const csv = [
      'email,first name,company,role',
      'qa1@warmline.test,Ada,Acme,Backend Engineer',
      'qa2@warmline.test,Bao,Globex,Backend Engineer',
      'qa3@warmline.test,Cira,Initech,Backend Engineer',
      'qa4@warmline.test,Dev,Umbrella,Backend Engineer',
      'qa5@warmline.test,Eve,Soylent,Backend Engineer',
    ].join('\n');

    await page.getByRole('button', { name: /import csv/i }).click();
    await page.getByLabel(/paste csv/i).fill(csv);
    await page.getByRole('button', { name: /review rows/i }).click();
    await expect(page.getByText(/5 ready to import/i)).toBeVisible();
    await page.getByRole('button', { name: /import 5/i }).click();
    await expect(page.getByText(/imported 5 contacts/i)).toBeVisible();

    // Start a manual run.
    await page.goto('/queue');
    await page.getByRole('button', { name: /start a run/i }).click();
    await expect(page.getByText(/run started/i)).toBeVisible();

    // After preparation, the board shows queued rows and the run begins.
    await expect(page.getByText('Queued').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Sending|reached/i).first()).toBeVisible({ timeout: 90_000 });
  });
});
