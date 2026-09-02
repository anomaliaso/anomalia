// Un solo invio con immagine: strumento per leggere [DEBUG-img] nel log del dev server.
import { chromium } from 'playwright';
const BASE = 'http://localhost:5185';
const browser = await chromium.launch({ headless: false, slowMo: 100 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.locator('input[name="email"]').fill('test@anomalia.so');
await page.locator('input[name="password"]').fill('123456');
await page.locator('form[action="?/login"] button[type="submit"]').click({ timeout: 120_000 });
await page.waitForURL(/\/app/, { timeout: 180_000 });
const dataUrl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 240; c.height = 240;
  const x = c.getContext('2d');
  x.fillStyle = '#c0392b'; x.fillRect(0, 0, 240, 240);
  x.fillStyle = '#ffffff'; x.font = 'bold 72px sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('A7X', 120, 120);
  return c.toDataURL('image/png');
});
import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/e2e-attach.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
await page.goto(`${BASE}/app/demo/chat/new?agent=content`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea.ch-input', { timeout: 60_000 });
await page.locator('textarea.ch-input').fill(`Cosa c'è scritto nell'immagine allegata? Riporta ESATTAMENTE il testo che vedi.`);
await page.locator('input[type="file"][accept*="image"]').first().setInputFiles('/tmp/e2e-attach.png');
await page.waitForTimeout(1500); // il downscale è async: lasciare finire
await page.locator('button.ch-send[type="submit"]').click();
console.log('inviato — thread:', await page.url());
await page.waitForTimeout(90_000);
const body = await page.evaluate(() => document.body.innerText);
const m = body.split('\n').filter(l => /A7X|vedo|allegat|immagine/i.test(l)).slice(0, 6).join(' | ');
console.log('page says:', m.slice(0, 400));
await browser.close();
