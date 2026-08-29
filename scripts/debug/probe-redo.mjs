import { chromium } from 'playwright';
const BASE = 'http://localhost:5185';
const THREAD_ID = '772c2578-f459-41e4-afc9-3c2cd4dafc93';
const browser = await chromium.launch({ headless: false, slowMo: 100 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('response', async (r) => {
  if (r.url().includes('/chat') && r.request().method() === 'POST') {
    console.log('POST', r.url(), '→', r.status());
    const body = await r.text().catch(() => '');
    if (!r.ok() || r.status() >= 400) console.log('   body:', body.slice(0, 300));
  }
});
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.locator('input[name="email"]').fill('test@anomalia.so');
await page.locator('input[name="password"]').fill('123456');
await page.locator('form[action="?/login"] button[type="submit"]').click({ timeout: 120_000 });
await page.waitForURL(/\/app/, { timeout: 180_000 });
await page.goto(`${BASE}/app/demo/chat/${THREAD_ID}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea.ch-input', { timeout: 60_000 });
await page.waitForTimeout(2500); // hydratazione
const btns = await page.locator('button[aria-label="Rigenera"]').count();
console.log('bottone Rigenera trovati:', btns);
const btn = page.locator('button[aria-label="Rigenera"]').first();
console.log('disabled?', await btn.isDisabled());
await btn.click();
await page.waitForTimeout(20_000);
const rows = await page.evaluate(() => document.querySelectorAll('button[aria-label="Rigenera"]').length);
console.log('finito attesa — bollard Rigenera in pagina:', rows);
await browser.close();
