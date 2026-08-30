import { test, expect } from '@playwright/test';

/**
 * L'UNICO file di questa cartella che ha bisogno di un database vero. Gli altri sono deterministici
 * per costruzione (v. README): `playwright.config.ts` avvia vite con un Supabase SEGNAPOSTO, quindi
 * `PUBLIC_SUPABASE_URL` è SEMPRE valorizzata e non può fare da guardia — la sua presenza non dice
 * che dietro ci sia uno stack con l'utente seminato. Serve un consenso esplicito, come per gli
 * altri test di integrazione del repo.
 */
const REAL_STACK = process.env.E2E_REAL_STACK === '1';
const SEEDED_USER = process.env.E2E_USER ?? 'test@anomalia.so';
const SEEDED_SECRET = process.env.E2E_PASSWORD ?? '123456';
const SEEDED_BRAND = 'demo';

test.describe.configure({ mode: 'serial' });

test.skip(!REAL_STACK, 'richiede uno stack disposable con utente seminato: E2E_REAL_STACK=1');

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByPlaceholder('you@yourbrand.com').fill(SEEDED_USER);
  await page.locator('input[type="password"]').fill(SEEDED_SECRET);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/app/);
}

test('un utente registrato entra con email e password e raggiunge il suo brand', async ({ page }) => {
  await signIn(page);
  await page.goto(`/app/${SEEDED_BRAND}`);

  await expect(page).toHaveURL(new RegExp(`/app/${SEEDED_BRAND}`));
});

test('la sessione sopravvive a un reload', async ({ page }) => {
  await signIn(page);
  await page.goto(`/app/${SEEDED_BRAND}`);
  await page.reload();

  await expect(page).toHaveURL(new RegExp(`/app/${SEEDED_BRAND}`));
});

test('una password sbagliata non apre la sessione', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('you@yourbrand.com').fill(SEEDED_USER);
  await page.locator('input[type="password"]').fill('non-la-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page).toHaveURL(/\/login/);
});

test('il client supabase riceve un URL vero, non undefined', async ({ page }) => {
  const bad: string[] = [];
  page.on('request', (r) => {
    if (/undefined|\/null\//.test(r.url())) bad.push(r.url());
  });

  await signIn(page);

  expect(bad).toEqual([]);
});
