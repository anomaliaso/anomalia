import { test, expect } from '@playwright/test';

// Login page renders its forms without a database. Headings are i18n'd copy: assert on the
// form wiring (actions and named inputs), which is the actual contract under test.
test('login page exposes email sign-in form', async ({ page }) => {
  const response = await page.goto('/login');

  expect(response?.status()).toBe(200);
  await expect(page.locator('form[action="?/login"]')).toBeVisible();
  await expect(page.locator('input[name="email"]')).toBeVisible();
});

test('oauth forms are wired', async ({ page }) => {
  await page.goto('/login');

  await expect(page.locator('form[action="?/google"]')).toHaveCount(1);
  await expect(page.locator('form[action="?/github"]')).toHaveCount(1);
});
