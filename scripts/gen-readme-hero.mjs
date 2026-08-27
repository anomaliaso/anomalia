#!/usr/bin/env node
/**
 * README hero: real BrandMark SVG + live homepage chat mockup (.cm),
 * laid out like Rakazo's readme-hero.png. Not a generated illustration.
 *
 *   node scripts/gen-readme-hero.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainRepo = join(root, '..', '..', 'anomalia');
let chromium;
try {
  ({ chromium } = await import(pathToFileURL(join(root, 'node_modules/playwright/index.mjs')).href));
} catch {
  ({ chromium } = await import(
    pathToFileURL(join(mainRepo, 'node_modules/playwright/index.mjs')).href
  ));
}

const BRAND_PATH =
  'M473.158 226.577C473.158 226.577 390.618 226.577 365.909 226.577C341.199 226.577 314.629 213.958 327.005 169.75C342.293 115.155 415.443 78.2267 473.158 78.2267C530.873 78.2267 604.023 115.155 619.311 169.75C631.697 213.958 605.116 226.577 580.407 226.577C555.698 226.577 473.158 226.577 473.158 226.577ZM49.0507 231.406C32.6058 231.301 16.1084 230.999 0 230.999V231.406V240.896V254.13H946.316V240.906V231.395V230.988C930.207 230.988 913.71 231.291 897.265 231.395H879.401C847.026 231.155 815.472 229.361 788.113 221.999C722.512 204.343 714.878 171.106 681.852 123.759C643.358 68.6113 577.505 0 473.158 0C368.811 0 302.958 68.6009 264.464 123.769C231.437 171.106 223.804 204.343 158.203 222.009C130.844 229.372 99.2896 231.166 66.915 231.406H49.0507ZM617.355 281.693H682.388C682.388 324.848 632.517 464 473.158 464C313.798 464 263.927 324.848 263.927 281.693H328.96C328.96 308.777 363.333 402.418 473.158 402.418C582.983 402.418 617.355 308.777 617.355 281.693Z';

const LOGO_SVG = `<svg width="73" height="36" viewBox="0 0 947 464" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#c485fe"/>
      <stop offset="100%" stop-color="rgb(236, 178, 237)"/>
    </linearGradient>
  </defs>
  <path fill-rule="evenodd" clip-rule="evenodd" d="${BRAND_PATH}" fill="url(#g)"/>
</svg>`;

const OUT = join(root, 'docs', 'readme-hero.png');
mkdirSync(join(root, 'docs'), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  locale: 'en-US',
  colorScheme: 'dark',
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 2,
  extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
});
await context.addInitScript(() => {
  localStorage.setItem('theme', 'dark');
});
await context.addCookies([
  { name: 'locale', value: 'en', url: 'https://www.anomalia.so/' },
  { name: 'locale', value: 'en', url: 'https://anomalia.so/' }
]);

const page = await context.newPage();
await page.goto('https://www.anomalia.so/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.locator('.cm').waitFor({ timeout: 30_000 });
await page.evaluate(() => {
  localStorage.setItem('theme', 'dark');
  document.documentElement.setAttribute('data-theme', 'dark');
});
await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
await page.locator('.cm').scrollIntoViewIfNeeded();
await page.waitForTimeout(1200);

for (const name of ['Accept', 'Accetta', 'Accept all', 'OK']) {
  const btn = page.getByRole('button', { name, exact: false });
  if (await btn.count()) {
    await btn.first().click({ timeout: 1500 }).catch(() => {});
  }
}

const mockPng = await page.locator('.cm').screenshot({ type: 'png' });

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; background: #020202; }
  #hero {
    width: 1280px;
    height: 640px;
    background: #020202;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #ededed;
    display: flex;
    flex-direction: column;
    padding: 36px 48px 0;
    box-sizing: border-box;
    overflow: hidden;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand svg { display: block; }
  .word {
    font-size: 22px;
    font-weight: 650;
    letter-spacing: -0.04em;
    color: #ededed;
  }
  .meta { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .pill {
    flex: none;
    border: 1px solid #c485fe;
    color: #c485fe;
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 12px;
    font-weight: 600;
  }
  .tag {
    font-size: 13px;
    font-weight: 500;
    color: #c485fe;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  h1 {
    margin: 22px 0 0;
    font-size: 42px;
    line-height: 1.1;
    letter-spacing: -0.045em;
    font-weight: 400;
    text-align: center;
    color: #ededed;
  }
  .sub {
    margin: 10px 0 0;
    text-align: center;
    font-size: 16px;
    line-height: 1.45;
    color: #a1a1a6;
  }
  .mock {
    margin: 20px auto 0;
    width: 900px;
    border-radius: 20px;
    overflow: hidden;
    box-shadow: 0 28px 64px -20px rgb(0 0 0 / 85%), 0 0 0 1px rgb(255 255 255 / 6%);
  }
  .mock img { display: block; width: 100%; height: auto; }
</style>
</head>
<body>
  <div id="hero">
    <div class="top">
      <div class="brand">
        ${LOGO_SVG}
        <span class="word">anomalia</span>
      </div>
      <div class="meta">
        <span class="pill">Apache-2.0</span>
        <span class="tag">Open source alternative to Grok Bot — specialized in marketing, distribution, and sales</span>
      </div>
    </div>
    <h1>Your marketing department, automated.</h1>
    <p class="sub">It plans, writes, designs and publishes across social, blog and SEO. Nothing goes out until you approve.</p>
    <div class="mock"><img alt="" src="data:image/png;base64,${mockPng.toString('base64')}" /></div>
  </div>
</body>
</html>`;

const frame = await context.newPage();
await frame.setViewportSize({ width: 1280, height: 640 });
await frame.setContent(html, { waitUntil: 'load' });
await frame.locator('#hero').screenshot({ path: OUT, type: 'png' });
await browser.close();

console.log('wrote', OUT);
