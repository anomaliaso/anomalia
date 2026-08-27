/**
 * Il pannello knowledge in chat, provato in un browser VERO.
 *
 * Cliccare una fonte "knowledge" sotto una risposta non deve portare via dalla chat: apre
 * un pannello a destra, sopra la topbar, con l'URL fermo. Sono le due cose che si vedono
 * solo guardandole — typecheck e unit test le hanno già lasciate passare rotte una volta.
 *
 * Cosa dimostra, per ogni combinazione tema × viewport:
 *   1. l'elenco fonti si apre;
 *   2. la fonte knowledge apre il pannello e l'URL NON cambia;
 *   3. il pannello COPRE la topbar (hit-test con elementFromPoint, non fiducia nello z-index);
 *   4. la sezione citata è evidenziata e visibile senza scorrere;
 *   5. click fuori ed Esc chiudono;
 *   6. nessun errore JS.
 *
 * Il documento e il messaggio con la fonte sono seminati qui (idempotenti, sul brand
 * fixture): lo script non dipende da dati che qualcuno potrebbe cancellare.
 *
 *   node scripts/chat-knowledge-panel-check.mjs
 *   APP_BASE=http://localhost:5199 node scripts/chat-knowledge-panel-check.mjs
 *
 * ponytail: asserzioni sequenziali, niente runner — la cosa più piccola che diventa rossa
 * quando il pannello smette di aprirsi.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const env = { ...process.env };
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !(m[1] in env)) env[m[1]] = m[2];
  }
} catch {
  /* no .env — rely on process.env */
}

const SUPABASE_URL = env.PUBLIC_SUPABASE_URL;
const ANON_KEY = env.PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = env.TEST_EMAIL ?? 'native-spine-test@anomalia.so';
const PASSWORD = env.TEST_PASSWORD ?? 'native-spine-test-9f2!';
const SLUG = env.TEST_BRAND_SLUG ?? 'native-spine-test';
// Di default si usa il dev server già in ascolto: mai prendersi la 5173 di qualcun altro.
const APP_BASE = env.APP_BASE ?? 'http://localhost:5173';
const SHOTS = env.SHOTS_DIR ?? '/tmp/chat-knowledge-panel';

// Righe fisse, così il seed è un upsert e non moltiplica i documenti a ogni giro.
const DOC_ID = '11111111-2222-4333-8444-555555555555';
const MSG_ID = '99999999-2222-4333-8444-555555555555';
const SECTION = 'Regole di pubblicazione';

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    'Missing PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY'
  );
  process.exit(1);
}

let failed = false;
const assert = (c, l, x = '') => {
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${x ? ` — ${x}` : ''}`);
  if (!c) failed = true;
};

const rest = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  });

const filler = (word, n) => Array.from({ length: n }, (_, i) => `${word} riga ${i + 1}.`).join('\n');

const MARKDOWN = [
  '# Refit contenuti — manuale operativo',
  '',
  'Documento di prova del pannello laterale: lungo apposta, così la sezione citata non è',
  'visibile senza scorrere.',
  '',
  '## Premessa',
  '',
  filler('Prima', 10),
  '',
  '## Cadenza settimanale',
  '',
  filler('Seconda', 12),
  '',
  '## Tono di voce',
  '',
  filler('Terza', 8),
  '',
  `## ${SECTION}`,
  '',
  'Questa è la sezione citata dalla fonte in chat: se il pannello funziona si apre già qui,',
  'evidenziata, senza che nessuno scorra.',
  '',
  '- Niente post senza approvazione.',
  '- Un solo canale per volta quando il piano cambia.',
  '',
  '## Appendice',
  '',
  'Ultima riga.'
].join('\n');

async function seed() {
  const [brand] = await (await rest(`brands?slug=eq.${SLUG}&select=id`)).json();
  if (!brand) throw new Error(`brand fixture ${SLUG} non trovato`);

  const [thread] = await (
    await rest(`chat_threads?brand_id=eq.${brand.id}&select=id&order=created_at.asc&limit=1`)
  ).json();
  if (!thread) throw new Error(`nessun thread sul brand fixture ${SLUG}`);

  const [anyMsg] = await (
    await rest(`chat_messages?brand_id=eq.${brand.id}&select=user_id&user_id=not.is.null&limit=1`)
  ).json();

  const upsert = (table, row) =>
    rest(table, {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(row)
    });

  const doc = await upsert('brand_documents', {
    id: DOC_ID,
    brand_id: brand.id,
    kind: 'note',
    title: 'Refit contenuti — manuale operativo',
    status: 'ready',
    markdown: MARKDOWN,
    source_type: 'manual',
    collection: 'operations',
    lang: 'it',
    chunk_count: 4,
    summary: 'Manuale operativo di prova per il pannello laterale.'
  });
  if (!doc.ok) throw new Error(`seed documento: ${doc.status} ${await doc.text()}`);

  const msg = await upsert('chat_messages', {
    id: MSG_ID,
    brand_id: brand.id,
    user_id: anyMsg?.user_id ?? null,
    thread_id: thread.id,
    role: 'assistant',
    content: 'Le regole di pubblicazione stanno nel manuale operativo.',
    sources: [
      {
        kind: 'knowledge',
        label: `Refit contenuti — manuale operativo › ${SECTION}`,
        documentId: DOC_ID,
        headingPath: SECTION
      }
    ]
  });
  if (!msg.ok) throw new Error(`seed messaggio: ${msg.status} ${await msg.text()}`);

  return `${APP_BASE}/app/${SLUG}/chat/${thread.id}`;
}

async function authCookie() {
  const grant = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  if (!grant.ok) throw new Error(`password grant ${grant.status}: ${await grant.text()}`);
  const session = await grant.json();
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  return {
    name: `sb-${ref}-auth-token`,
    value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'),
    url: APP_BASE
  };
}

const PANEL = '[data-slot="sheet-content"][data-side="right"]';

async function round(browser, cookie, url, { theme, width, height, tag }) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
  await context.addCookies([cookie]);
  const page = await context.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && jsErrors.push(m.text()));

  // `networkidle` non arriva mai: la chat fa polling. Si aspetta il contenuto, non la rete.
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const cc = page.locator('.cc-actions .cc-btn').last();
  if (await cc.count()) {
    await cc.click().catch(() => {});
    await page.locator('.cc').waitFor({ state: 'detached', timeout: 4000 }).catch(() => {});
  }
  // Il tema è una preferenza dell'app, non solo prefers-color-scheme.
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);

  const urlBefore = page.url();

  // 1. l'elenco fonti
  const row = page.locator('.src-row').last();
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await row.click();
  const item = page.locator('.src-item', { hasText: 'Refit contenuti' }).first();
  await item.waitFor({ state: 'visible', timeout: 10_000 });
  assert(true, `${tag} · l'elenco fonti si apre`);

  // 2. la fonte apre il pannello, non una pagina
  await item.click();
  const panel = page.locator(PANEL);
  await panel.waitFor({ state: 'visible', timeout: 15_000 });
  await page
    .waitForFunction(() => !!document.querySelector('.kp-body h2'), { timeout: 15_000 })
    .catch(() => {});
  assert(page.url() === urlBefore, `${tag} · l'URL non cambia`, page.url());

  // 3. sopra la topbar, misurato
  const cover = await page.evaluate((sel) => {
    const p = document.querySelector(sel);
    const bar = document.querySelector('.page-topbar') || document.querySelector('header');
    if (!p || !bar) return { ok: false, why: `panel=${!!p} bar=${!!bar}` };
    const pr = p.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    const x = Math.min(pr.right, br.right) - 4;
    const y = Math.max(pr.top, br.top) + Math.min(20, br.height / 2);
    if (x <= Math.max(pr.left, br.left)) return { ok: false, why: 'non si sovrappongono' };
    const hit = document.elementFromPoint(x, y);
    return {
      ok: !!hit?.closest('[data-slot="sheet-content"]'),
      panelZ: getComputedStyle(p).zIndex,
      barZ: getComputedStyle(bar).zIndex
    };
  }, PANEL);
  assert(cover.ok, `${tag} · il pannello copre la topbar`, JSON.stringify(cover));

  // 4. la sezione citata
  const hit = await page.evaluate(() => {
    const el = document.querySelector('.kp-body .kp-hit');
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const body = document.querySelector('.kp-body').getBoundingClientRect();
    return {
      text: el.textContent.trim(),
      visible: box.top >= body.top - 2 && box.top < body.bottom
    };
  });
  assert(!!hit?.visible, `${tag} · si apre sulla sezione citata`, JSON.stringify(hit));

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${tag}.png` });

  // 5. click fuori, poi Esc
  await page.mouse.click(20, Math.round(height / 2));
  await panel.waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {});
  assert(await panel.isHidden(), `${tag} · il click fuori chiude`);

  await row.click();
  await item.waitFor({ state: 'visible', timeout: 8000 });
  await item.click();
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {});
  assert(await panel.isHidden(), `${tag} · Esc chiude`);
  assert(page.url() === urlBefore, `${tag} · l'URL è ancora quello`, page.url());

  // 6. errori JS (il 429 è il rate limit del dev server sotto quattro giri di fila)
  const real = jsErrors.filter((e) => !/favicon|posthog|sentry|net::ERR|status of 429/i.test(e));
  assert(real.length === 0, `${tag} · nessun errore JS`, real.slice(0, 3).join(' | '));

  await context.close();
}

const url = await seed();
console.log(`Thread di prova: ${url}`);
const cookie = await authCookie();
const browser = await chromium.launch();
for (const r of [
  { theme: 'light', width: 1440, height: 900, tag: 'desktop-light' },
  { theme: 'dark', width: 1440, height: 900, tag: 'desktop-dark' },
  { theme: 'light', width: 390, height: 780, tag: 'mobile-light' },
  { theme: 'dark', width: 390, height: 780, tag: 'mobile-dark' }
]) {
  console.log(`\n== ${r.tag}`);
  try {
    await round(browser, cookie, url, r);
  } catch (e) {
    assert(false, `${r.tag} · giro completato`, String(e).slice(0, 200));
  }
}
await browser.close();
console.log(`\nScreenshot in ${SHOTS}`);
console.log(failed ? 'FAILED' : 'OK');
process.exit(failed ? 1 : 0);
