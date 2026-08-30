import { test, expect } from '@playwright/test';

// The landing is db-free for anonymous visitors: the waitlist flag RPC fails open and
// session lookup short-circuits on an empty cookie. Assert structure, never marketing copy.
test('landing renders with hero heading and site nav', async ({ page }) => {
  const response = await page.goto('/');

  expect(response?.status()).toBe(200);
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('header.nav')).toBeVisible();
});

test('the desktop bar offers sign-in as its own link, not folded into the CTA', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('header.nav .nav-right a[href="/login"]')).toHaveCount(1);
  await expect(page.locator('header.nav a.nav-cta')).toHaveCount(1);
});

test('a returning visitor on a phone finds sign-in inside the menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const burger = page.locator('header.nav .nav-burger');
  const signIn = page.locator('.nav-dialog a[href="/login"]');

  await expect(async () => {
    await burger.click();
    await expect(signIn).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
});
