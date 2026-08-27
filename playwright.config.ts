import { defineConfig, devices } from '@playwright/test';

// Smoke suite against the dev server with PLACEHOLDER Supabase env: every target page is
// db-free by design (see tests/e2e/README.md). Port 4173 stays clear of a developer's own
// `npm run dev` on 5173.
const E2E_PORT = 4173;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite dev --port ${E2E_PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Boot-minimal env (verified: the app starts without a real database and every
      // smoke target answers). NO_HMR keeps the server quiet under parallel workers.
      PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      PUBLIC_SUPABASE_ANON_KEY: 'e2e-placeholder-anon-key',
      NO_HMR: '1'
    }
  }
});
