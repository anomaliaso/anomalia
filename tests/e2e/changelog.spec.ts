import { test, expect } from '@playwright/test';

// Changelog entries are in-code (src/routes/[[lang=locale]]/changelog/+page.svelte), so the
// page renders without any service. Entry titles are volatile by nature: assert the list
// exists and has items, not what any single item says.
test('changelog renders its entry list', async ({ page }) => {
  const response = await page.goto('/changelog');

  expect(response?.status()).toBe(200);
  await expect(page.locator('h1.cl-title')).toBeVisible();
  const items = page.locator('main ul li');
  expect(await items.count()).toBeGreaterThan(0);
});
