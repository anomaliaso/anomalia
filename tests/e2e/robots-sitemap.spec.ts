import { test, expect } from '@playwright/test';

test('robots.txt disallows the app', async ({ request }) => {
  const response = await request.get('/robots.txt');

  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('Disallow: /app');
});

test('sitemap.xml is a valid urlset document', async ({ request }) => {
  const response = await request.get('/sitemap.xml');

  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('<urlset');
});
