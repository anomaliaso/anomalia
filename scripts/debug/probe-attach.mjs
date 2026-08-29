import { chromium } from 'playwright';
const BASE = 'http://localhost:5185';
const browser = await chromium.launch({ headless: false, slowMo: 80 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.locator('input[name="email"]').fill('test@anomalia.so');
await page.locator('input[name="password"]').fill('123456');
await page.locator('form[action="?/login"] button[type="submit"]').click({ timeout: 120_000 });
await page.waitForURL(/\/app/, { timeout: 180_000 });
await page.goto(`${BASE}/app/demo/chat/new?agent=content`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea.ch-input', { timeout: 60_000 });
await page.locator('textarea.ch-input').fill('test');
await page.locator('input[type="file"][accept*="image"]').first().setInputFiles('/tmp/e2e-attach.png');
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1000);
  const refs = await page.locator('.ch-refs .ch-ref').count();
  const err = await page.locator('.ch-ref-err').innerText().catch(() => '');
  if (refs > 0 || err) { console.log(`t+${i+1}s refs=${refs} err="${err}"`); break; }
}
const refCount = await page.locator('.ch-refs .ch-ref').count();
console.log('refs finali:', refCount);
await browser.close();
