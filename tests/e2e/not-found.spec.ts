import { test, expect } from '@playwright/test';

// The single project-wide error page (src/routes/+error.svelte) renders for unmatched routes.
// Its text is i18n'd and status-dependent; the card and the echoed status code are stable.
test('unmatched route renders the error page with 404', async ({ page }) => {
  const response = await page.goto('/percorso-inesistente-e2e');

  expect(response?.status()).toBe(404);
  await expect(page.locator('.err-card')).toBeVisible();
  await expect(page.locator('.err-code')).toHaveText('404');
});
