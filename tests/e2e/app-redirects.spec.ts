import { test, expect } from '@playwright/test';

// Unauthenticated /app and /app/[brand] redirect to /login BEFORE any database query
// (src/routes/app/+page.server.ts, src/routes/app/[brand]/+layout.server.ts), so this is a
// db-free assertion. HTTP-level on purpose: we assert the destination URL, never post-login
// content — no real auth in smoke tests.
test('unauthenticated /app redirects to /login', async ({ request }) => {
  const response = await request.get('/app', { maxRedirects: 0 });

  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe('/login');
});

test('unauthenticated /app/[brand] redirects to /login', async ({ request }) => {
  const response = await request.get('/app/qualunque-brand', { maxRedirects: 0 });

  expect(response.status()).toBe(303);
  expect(response.headers().location).toBe('/login');
});
