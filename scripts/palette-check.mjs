/**
 * La ricerca globale (⌘K) e le scorciatoie, provate in un browser VERO.
 *
 * Stessa tecnica di scripts/settings-modal-check.mjs (password grant su Supabase + cookie
 * @supabase/ssr forgiato, dev server su una porta libera): asserzioni sequenziali, niente runner.
 *
 * Cosa dimostra, in ordine:
 *   1. ⌘K/Ctrl+K apre la palette, e l'ingresso visibile in topbar fa la stessa cosa;
 *   2. scrivendo compaiono risultati RAGGRUPPATI (pagine, impostazioni, agenti, chat…);
 *   3. le frecce muovono la selezione;
 *   4. Invio su una pagina la apre in OVERLAY (.sm-dialog) e l'URL non cambia;
 *   5. Esc chiude la palette e non la modal sotto;
 *   6. una ricerca senza risultati dice qualcosa invece di restare vuota;
 *   7. `?` mostra la scheda delle scorciatoie, generata dal registro;
 *   8. `g` poi `c` salta al calendario in overlay, URL fermo;
 *   9. scrivendo nel campo, i tasti nudi NON sono scorciatoie;
 *  10. nessun errore JS in tutto il giro.
 * E lascia gli screenshot (chiaro + scuro) dei tre stati in SHOT_DIR.
 *
 *   node scripts/palette-check.mjs
 *   APP_BASE=http://localhost:5199 node scripts/palette-check.mjs
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const env = { ...process.env };
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !(m[1] in env)) env[m[1]] = m[2];
  }
} catch {
  /* no .env */
}

const SUPABASE_URL = env.PUBLIC_SUPABASE_URL;
const ANON_KEY = env.PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = env.TEST_EMAIL ?? 'native-spine-test@anomalia.so';
const PASSWORD = env.TEST_PASSWORD ?? 'native-spine-test-9f2!';
const SLUG = env.TEST_BRAND_SLUG ?? 'native-spine-test';
// Mai la 5173: è il dev server del proprietario.
const PORT = Number(env.PALETTE_PORT ?? 5199);
let APP_BASE = env.APP_BASE ?? `http://localhost:${PORT}`;
const SHOT_DIR = env.SHOT_DIR ?? '/tmp/palette-shots';

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
  mkdirSync(SHOT_DIR, { recursive: true });
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

  // Il primo caricamento su un dev server appena avviato compila mezza app: 30s non bastano.
  await page.goto(`${APP_BASE}/app/${SLUG}`, { waitUntil: 'networkidle', timeout: 180_000 });
  const ccBtn = page.locator('.cc-actions .cc-btn').last();
  if (await ccBtn.count()) {
    await ccBtn.click();
    await page.locator('.cc').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  }
  await page
    .waitForFunction(() => document.documentElement.dataset.settingsModal === 'ready', {
      timeout: 60_000
    })
    .catch(() => fail('0. la shell non si è idratata'));
  const urlBefore = page.url();
  const palette = page.locator('.cp-dialog');
  const modal = page.locator('.sm-dialog');
  jsErrors.length = 0;

  // 1. ⌘K / Ctrl+K
  await page.keyboard.press('Control+k');
  let opened = await palette.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  assert(opened, '1. Ctrl+K apre la palette');
  if (!opened) {
    console.error('     errori JS:', jsErrors.slice(0, 5));
    await browser.close();
    return;
  }
  // 250ms prima dello scatto: l'animazione d'ingresso parte da opacity 0, e senza attesa
  // lo screenshot coglie il primo fotogramma — una palette invisibile in una prova verde.
  const blur = () =>
    page.evaluate(() =>
      document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null
    );
  const bellClip = async (pg) => {
    const r = await pg.locator('button.um-bell').boundingBox();
    return r
      ? { x: Math.max(0, r.x - 130), y: Math.max(0, r.y - 22), width: 250, height: r.height + 44 }
      : { x: 0, y: 0, width: 250, height: 60 };
  };
  const shot = async (name) => {
    await page.waitForTimeout(250);
    return page.screenshot({ path: `${SHOT_DIR}/${name}.png` });
  };
  await shot('light-empty');
  assert(
    (await page.locator('.cp-item').count()) > 0,
    '1b. a campo vuoto mostra già azioni e chat recenti',
    `${await page.locator('.cp-item').count()} righe`
  );
  await page.keyboard.press('Escape');
  await palette.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

  // 1c. l'ingresso visibile è la RIGA IN SIDEBAR (e in topbar non c'è più nessun pill).
  assert(
    (await page.locator('button.topbar-search').count()) === 0,
    '1c. il pill della ricerca non è più in topbar'
  );
  const entry = page.locator('button.thread-search');
  assert((await entry.count()) === 1, '1c2. un solo ingresso visibile, in sidebar');
  assert(
    (await entry.locator('.thread-search-kbd').innerText()).trim() === '⌘K',
    '1c3. con il chip della scorciatoia accanto'
  );
  await entry.click();
  opened = await palette.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  assert(opened, '1d. la riga in sidebar apre la palette');

  // 2. risultati raggruppati. Si aspetta il caret nel campo: una persona scrive quando il
  // cursore lampeggia, non un istante prima.
  const focused = page.locator('.cp-input');
  await focused.waitFor({ state: 'visible', timeout: 5000 });
  await focused.click();
  await page.keyboard.type('calendar');
  await page.waitForTimeout(700);
  const groupLabels = await page.locator('.cp-group-label').allInnerTexts();
  assert(groupLabels.length > 0, '2. i risultati sono raggruppati per tipo', groupLabels.join(' | '));
  const firstKind = (await page.locator('.cp-item').first().locator('.cp-kind').innerText()).trim();
  assert(/pagin|page|página/i.test(firstKind), '2b. il primo risultato è una PAGINA', firstKind);
  await shot('light-results');

  // 2c. i MESSAGGI: l'unico gruppo che va sul server (debounce + ilike).
  for (let i = 0; i < 8; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('pong');
  await page.waitForTimeout(1200);
  const kinds = await page.locator('.cp-item .cp-kind').allInnerTexts();
  assert(
    kinds.some((k) => /messag/i.test(k)),
    '2c. la ricerca trova anche dentro i MESSAGGI',
    kinds.join(' | ')
  );

  // 2d. se la ricerca messaggi non è disponibile, il resto della palette regge.
  await page.route('**/chat/search*', (r) => r.abort());
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('calendar');
  await page.waitForTimeout(1200);
  const degraded = await page.locator('.cp-item').count();
  assert(degraded > 0, '2d. ricerca messaggi rotta → il resto resta', `${degraded} righe`);
  await page.unroute('**/chat/search*');
  for (let i = 0; i < 8; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('calendar');
  await page.waitForTimeout(700);

  // 3. le frecce muovono la selezione
  // L'ID, non l'etichetta: due pagine diverse possono chiamarsi uguale (`/calendar` e
  // `/content` sono entrambe "Calendar"), e un confronto sul testo direbbe "non si è mosso".
  const selected = async () =>
    (await page.locator('.cp-item[aria-selected="true"]').getAttribute('id')) ?? '';
  const first = await selected();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);
  const second = await selected();
  assert(second !== first, '3. ↓ muove la selezione', `${first} → ${second}`);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(120);
  assert((await selected()) === first, '3b. ↑ torna indietro');

  // 9. scrivendo NEL CAMPO i tasti nudi non sono scorciatoie
  await page.keyboard.type('gn');
  await page.waitForTimeout(200);
  const typed = await page.locator('.cp-input').inputValue();
  assert(typed === 'calendargn', '9. `g` e `n` scritti nel campo restano testo', JSON.stringify(typed));
  for (let i = 0; i < 2; i++) await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);

  // 4. Invio apre la pagina in OVERLAY, senza cambiare URL
  await page.keyboard.press('Enter');
  const inModal = await modal.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
  assert(inModal, '4. Invio apre la pagina nella modal (openPageModal)');
  assert(page.url() === urlBefore, '4b. e l’URL non cambia', page.url());
  assert(!(await palette.isVisible().catch(() => false)), '4c. la palette si chiude aprendo');

  // 5. Esc chiude la palette, non la modal sotto
  await page.keyboard.press('Control+k');
  await palette.waitFor({ state: 'visible', timeout: 8000 });
  await page.keyboard.press('Escape');
  await palette.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  assert(!(await palette.isVisible().catch(() => false)), '5. Esc chiude la palette');
  assert(await modal.isVisible().catch(() => false), '5b. e NON la modal sotto (Esc = il più in alto)');
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

  // 6. nessun risultato → un messaggio, non il vuoto
  await page.keyboard.press('Control+k');
  await palette.waitFor({ state: 'visible', timeout: 8000 });
  await page.keyboard.type('qzxwvu');
  await page.waitForTimeout(800);
  const emptyText = (await page.locator('.cp-empty').innerText().catch(() => '')).trim();
  assert(emptyText.length > 10, '6. senza risultati dice cosa provare', JSON.stringify(emptyText.slice(0, 60)));
  await shot('light-empty-results');
  await page.keyboard.press('Escape');
  await palette.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

  // 7. `?` → la scheda delle scorciatoie. `type` e non `press('Shift+/')`: quella scorciatoia
  // di Playwright consegna `key: '/'`, che nel prodotto è "vai al campo del messaggio" — il
  // test fallirebbe per il tasto sbagliato, non per il codice.
  await blur();
  await page.keyboard.type('?');
  const help = await palette.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  const helpRows = await page.locator('.cp-help li').count();
  assert(help && helpRows >= 10, '7. `?` apre la scheda delle scorciatoie', `${helpRows} righe`);
  await shot('light-help');
  await page.keyboard.press('Escape');
  await palette.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

  // 8. `g` poi `c` → calendario in overlay
  await blur();
  await page.keyboard.press('g');
  await page.keyboard.press('c');
  const wentToCalendar = await modal.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
  const head = wentToCalendar ? (await page.locator('.sm-head h2').innerText()).trim() : '';
  assert(wentToCalendar, '8. `g` poi `c` apre una pagina in overlay', head);
  assert(page.url() === urlBefore, '8b. e l’URL resta fermo', page.url());
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

  // 8c. le SEZIONI della sidebar: `g w` (Web) e `g m` (Social media), sempre in overlay.
  for (const [letter, what] of [['w', 'Web'], ['m', 'Social media']]) {
    await blur();
    await page.keyboard.press('g');
    await page.keyboard.press(letter);
    const on = await modal.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    const h = on ? (await page.locator('.sm-head h2').innerText()).trim() : '';
    assert(on, `8c. \`g ${letter}\` apre la sezione ${what} in overlay`, h);
    assert(page.url() === urlBefore, `8c. \`g ${letter}\` non tocca l'URL`, page.url());
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  }

  // ── La campanella in fondo alla sidebar ───────────────────────────────────────────────────
  const bell = page.locator('button.um-bell');
  assert((await bell.count()) === 1, '11. la campanella è in fondo alla sidebar');
  assert(
    (await page.locator('.page-topbar .topbar-warn-btn').count()) === 0,
    '11b. e non è più in topbar (spostata, non duplicata)'
  );
  const badge = page.locator('.um-bell-count');
  const badgeN = async () =>
    (await badge.count()) ? Number((await badge.innerText()).trim()) : 0;
  const before = await badgeN();
  assert(before > 0, '12. il badge parte con le segnalazioni non viste', String(before));

  // Allineamento: la pillola sta dentro il quadrato del bottone, ancorata all'angolo.
  const geom = await page.evaluate(() => {
    const b = document.querySelector('button.um-bell');
    const c = document.querySelector('.um-bell-count');
    if (!b || !c) return null;
    const rb = b.getBoundingClientRect();
    const rc = c.getBoundingClientRect();
    const st = getComputedStyle(c);
    return {
      dTop: Math.abs(rc.top - rb.top),
      dRight: Math.abs(rc.right - rb.right),
      h: Math.round(rc.height),
      nums: st.fontVariantNumeric,
      pos: st.position
    };
  });
  assert(
    !!geom && geom.pos === 'absolute' && geom.dTop <= 3 && geom.dRight <= 3 && geom.h <= 18,
    '12b. il badge è ancorato all’angolo dell’icona, compatto',
    JSON.stringify(geom)
  );
  assert(geom?.nums?.includes('tabular-nums'), '12c. cifre tabulari, come i non letti dei thread');
  await page.screenshot({ path: `${SHOT_DIR}/light-bell.png`, clip: await bellClip(page) });

  // 13. aprendo il pannello il conteggio cala…
  await bell.click();
  const drawer = page.locator('.wc-drawer');
  const drawerOpen = await drawer.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  assert(drawerOpen, '13. la campanella apre il pannello da qui');
  const total = (await page.locator('.wc-chip').first().innerText()).trim();
  assert(total.includes(String(before)), '13b. il pannello mostra il TOTALE (viste comprese)', total);
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  assert((await badgeN()) === 0, '14. dopo averle guardate il badge si spegne', String(await badgeN()));

  // 15. arriva una segnalazione NUOVA → il badge si riaccende, e conta solo quella.
  // Si simula togliendo un id dal segnalibro: per il codice del badge è indistinguibile da
  // "questo id non l'avevi mai visto". Nessuna scrittura sul database.
  // Va PRIMA della prova "non torna": è anche la prova che entro questa attesa gli avvisi sono
  // arrivati davvero — altrimenti un badge assente perché in ritardo passerebbe per "spento".
  await page.evaluate((slug) => {
    const k = `anomalia.warningsSeen.${slug}`;
    const seen = JSON.parse(localStorage.getItem(k) || '[]');
    localStorage.setItem(k, JSON.stringify(seen.slice(1)));
  }, SLUG);
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  const lit = await page
    .waitForFunction(
      () => document.querySelector('.um-bell-count')?.textContent?.trim() === '1',
      { timeout: 30_000 }
    )
    .then(() => true, () => false);
  assert(lit, '15. una segnalazione nuova riaccende il badge, e conta 1', String(await badgeN()));

  // 16. …e una già vista non risale ricaricando (il segnalibro è su disco, non in memoria).
  await bell.click();
  await drawer.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await page.reload({ waitUntil: 'networkidle', timeout: 180_000 });
  await page.waitForTimeout(6000);
  assert((await badgeN()) === 0, '16. ricaricando resta spento (già viste, non tornano)', String(await badgeN()));

  // ── Gli stessi tre stati, a tema scuro ────────────────────────────────────────────────────
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+k');
  await palette.waitFor({ state: 'visible', timeout: 8000 });
  await shot('dark-empty');
  await page.keyboard.type('calendar');
  await page.waitForTimeout(700);
  await shot('dark-results');
  for (let i = 0; i < 8; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('qzxwvu');
  await page.waitForTimeout(800);
  await shot('dark-empty-results');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOT_DIR}/dark-bell.png`, clip: await bellClip(page) });
  await page.screenshot({
    path: `${SHOT_DIR}/dark-sidebar.png`,
    clip: { x: 0, y: 0, width: 300, height: 900 }
  });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${SHOT_DIR}/light-sidebar.png`,
    clip: { x: 0, y: 0, width: 300, height: 900 }
  });
  await page.screenshot({ path: `${SHOT_DIR}/light-topbar.png`, clip: { x: 220, y: 0, width: 1220, height: 60 } });
  console.log(`  screenshot in ${SHOT_DIR}`);

  // ERR_FAILED è la fetch che il passo 2d ABORTA di proposito per provare il degrado, e
  // "Failed to fetch" è il polling interrotto dalle navigazioni: rumore del banco di prova.
  const noisy = jsErrors.filter(
    (e) => !/favicon|Failed to load resource.*40[34]|Failed to fetch|ERR_FAILED/i.test(e)
  );
  assert(noisy.length === 0, '10. nessun errore JS in console', noisy.slice(0, 3).join(' | '));

  await browser.close();
}

try {
  await run();
} catch (err) {
  fail('lo script è esploso', err instanceof Error ? err.message : String(err));
} finally {
  stopServer();
}

console.log(failed ? '\nROSSO — nel browser la ricerca globale non fa quello che deve.' : '\nVERDE — provato in un browser vero.');
process.exit(failed ? 1 : 0);
