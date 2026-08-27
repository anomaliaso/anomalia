/**
 * UN LINK CON PARAMETRI, APERTO IN SOVRAPPOSIZIONE, ARRIVA DOVE DEVE.
 *
 * Da quando le pagine del brand non hanno più un percorso vero (PageModal: l'URL non
 * cambia mai), una pagina che leggeva `page.url.searchParams` nel client leggeva l'URL
 * del BROWSER — cioè la pagina sotto. Il `load` server i parametri li vedeva lo stesso,
 * quindi il difetto era muto: `/knowledge?doc=X` apriva Knowledge e ignorava il
 * documento. La correzione è `$lib/page-query.ts` (`pageQuery()`), un solo posto da cui
 * una pagina legge i propri parametri, uguale dentro e fuori dalla modal.
 *
 * Questo script lo prova in un browser vero, in entrambi i mondi:
 *   1. FULL   /knowledge?doc=<id>       → il documento si apre (com'era prima)
 *   2. MODAL  stesso link dalla home    → il documento si apre, e l'URL non si muove
 *   3. MODAL  /knowledge senza doc      → NIENTE si apre (è il parametro a farlo, non altro)
 *   4. FULL   /site?from=plan&n=7       → il banner con "7" (com'era prima)
 *   5. MODAL  stesso link dalla home    → lo stesso banner con "7"
 *   6. nessun errore JS in tutto il giro
 *
 *   node scripts/modal-query-check.mjs
 *   APP_BASE=http://localhost:5199 node scripts/modal-query-check.mjs
 *
 * ponytail: asserzioni sequenziali come settings-modal-check.mjs, niente runner.
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
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
const EMAIL = env.TEST_EMAIL ?? 'native-spine-test@anomalia.so';
const PASSWORD = env.TEST_PASSWORD ?? 'native-spine-test-9f2!';
const SLUG = env.TEST_BRAND_SLUG ?? 'native-spine-test';
// Mai la 5173: è il dev server del proprietario.
const PORT = Number(env.MODAL_QUERY_PORT ?? 5201);
const APP_BASE = env.APP_BASE ?? `http://localhost:${PORT}`;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Missing PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

let failed = false;
const ok = (l, x = '') => console.log(`  PASS  ${l}${x ? ` — ${x}` : ''}`);
const fail = (l, x = '') => {
  failed = true;
  console.error(`  FAIL  ${l}${x ? ` — ${x}` : ''}`);
};
const assert = (cond, l, x = '') => (cond ? ok(l, x) : fail(l, x));

const reachable = async (base) => {
  try {
    await fetch(base, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
};

let devServer = null;
async function ensureServer() {
  if (await reachable(APP_BASE)) {
    console.log(`Dev server già in ascolto su ${APP_BASE}`);
    return;
  }
  console.log(`Avvio dev server su :${PORT} …`);
  devServer = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore'
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await reachable(APP_BASE)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`dev server non risponde su ${APP_BASE}`);
}
const stopServer = () => devServer?.kill('SIGTERM');

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

async function run() {
  await ensureServer();
  const cookie = await authCookie();
  ok('sessione reale per la fixture', EMAIL);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([cookie]);
  const page = await context.newPage();

  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') jsErrors.push(m.text());
  });

  const dismissCookieBanner = async () => {
    const b = page.locator('.cc-actions .cc-btn').last();
    if (await b.count()) {
      await b.click().catch(() => {});
      await page.locator('.cc').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    }
  };
  const waitArmed = () =>
    page
      .waitForFunction(() => document.documentElement.dataset.settingsModal === 'ready', {
        timeout: 90_000
      })
      .then(() => true, () => false);

  /** Apre un href dalla HOME come farebbe un link del prodotto: click vero, interceptor globale. */
  async function openInModal(href) {
    await page.goto(`${APP_BASE}/app/${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    await dismissCookieBanner();
    if (!(await waitArmed())) {
      fail(`la modal non si è armata prima di aprire ${href}`);
      return null;
    }
    jsErrors.length = 0;
    const urlBefore = page.url();
    // Un <a> vero iniettato nella pagina: l'interceptor di PageModal è globale in
    // capture, quindi questo è lo STESSO percorso di ogni link del prodotto.
    await page.evaluate((h) => {
      const a = document.createElement('a');
      a.id = 'mqc-probe';
      a.href = h;
      a.textContent = 'probe';
      a.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;background:#fff';
      document.body.appendChild(a);
    }, href);
    await page.locator('#mqc-probe').click({ timeout: 30_000 });
    const dialog = page.locator('.sm-dialog');
    const opened = await dialog
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true, () => false);
    if (!opened) {
      fail(`la modal non si è aperta su ${href}`, page.url());
      return null;
    }
    await page
      .waitForFunction(
        () => (document.querySelector('.sm-body')?.textContent ?? '').trim().length > 40,
        { timeout: 30_000 }
      )
      .catch(() => {});
    return urlBefore;
  }

  // ── il documento su cui provare ────────────────────────────────────────────────
  await page.goto(`${APP_BASE}/app/${SLUG}/knowledge`, {
    waitUntil: 'domcontentloaded',
    timeout: 180_000
  });
  await dismissCookieBanner();
  await page.locator('li.doc-row[data-doc-id]').first().waitFor({ timeout: 30_000 }).catch(() => {});
  const docId = await page
    .locator('li.doc-row[data-doc-id]')
    .first()
    .getAttribute('data-doc-id')
    .catch(() => null);
  if (!docId) {
    fail('il brand fixture non ha nemmeno un documento in Knowledge: niente da provare');
    await browser.close();
    return;
  }
  ok('un documento della fixture su cui provare', docId);

  // ── 1. FUORI dalla modal: com'era prima (la regressione più probabile) ─────────
  await page.goto(`${APP_BASE}/app/${SLUG}/knowledge?doc=${docId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180_000
  });
  await dismissCookieBanner();
  const fullDrawer = await page
    .locator('aside.drawer')
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true, () => false);
  assert(fullDrawer, '1. pagina piena: ?doc= apre il documento (nessuna regressione)');

  // ── 2. DENTRO la modal: stesso link, stesso risultato ─────────────────────────
  const urlBefore = await openInModal(`/app/${SLUG}/knowledge?doc=${docId}`);
  if (urlBefore) {
    const modalDrawer = await page
      .locator('.sm-body aside.drawer')
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true, () => false);
    assert(modalDrawer, '2. in modal: ?doc= apre lo STESSO documento');
    assert(page.url() === urlBefore, '2b. e l’URL non si è mosso', `${urlBefore} → ${page.url()}`);
  }

  // ── 3. controllo negativo: senza parametro non si apre niente ─────────────────
  if (await openInModal(`/app/${SLUG}/knowledge`)) {
    await page.waitForTimeout(1500);
    const stray = await page.locator('.sm-body aside.drawer').count();
    assert(stray === 0, '3. in modal senza ?doc= NON si apre nessun documento', `drawer=${stray}`);
  }

  // ── 4/5. secondo caso, tutto guidato dai parametri: /site?from=plan&n=7 ───────
  const expected = 'Generati 7 articoli dal piano.';
  await page.goto(`${APP_BASE}/app/${SLUG}/site?from=plan&n=7`, {
    waitUntil: 'domcontentloaded',
    timeout: 180_000
  });
  await dismissCookieBanner();
  const fullBanner = await page
    .locator('p.banner', { hasText: expected })
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true, () => false);
  assert(fullBanner, '4. pagina piena: ?from=plan&n=7 mostra il banner (nessuna regressione)');

  const urlBefore2 = await openInModal(`/app/${SLUG}/site?from=plan&n=7`);
  if (urlBefore2) {
    const modalBanner = await page
      .locator('.sm-body p.banner', { hasText: expected })
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true, () => false);
    assert(modalBanner, '5. in modal: ?from=plan&n=7 mostra lo STESSO banner');
    assert(page.url() === urlBefore2, '5b. e l’URL non si è mosso', page.url());
  }

  const noisy = jsErrors.filter((e) => !/favicon|Failed to (load resource|fetch)|40[34]/i.test(e));
  assert(noisy.length === 0, '6. nessun errore JS in console', noisy.slice(0, 3).join(' | '));

  await browser.close();
}

try {
  await run();
} catch (err) {
  fail('lo script è esploso', err instanceof Error ? err.message : String(err));
} finally {
  stopServer();
}

console.log(
  failed
    ? '\nROSSO — un link con parametri non arriva dove deve.'
    : '\nVERDE — provato in un browser vero, dentro e fuori dalla modal.'
);
process.exit(failed ? 1 : 0);
