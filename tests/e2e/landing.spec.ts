import { test, expect } from '@playwright/test';

// The landing is db-free for anonymous visitors: the waitlist flag RPC fails open and
// session lookup short-circuits on an empty cookie. Assert structure, never marketing copy.
test('landing renders with hero heading and site nav', async ({ page }) => {
  const response = await page.goto('/');

  expect(response?.status()).toBe(200);
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('header.nav')).toBeVisible();
});
