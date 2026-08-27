/**
 * La modal Impostazioni, provata in un browser VERO.
 *
 * Due giri di questa feature sono stati consegnati "verdi" (unit test + typecheck) e
 * nel prodotto non si aprivano: il difetto era nel metodo di verifica. Questo script
 * guida l'app reale con Playwright e fallisce se l'utente non vedrebbe la sezione.
 *
 * Cosa dimostra, in ordine:
 *   1. click sull'ingranaggio → la modal compare;
 *   2. il rail elenca le sezioni;
 *   3. il CORPO contiene contenuto vero della sezione (testo della pagina, non un div);
 *   4. cambiando sezione dal rail il corpo cambia davvero;
 *   5. Esc chiude e l'URL non è MAI cambiato (la modal è stato, non una rotta);
 *   6. nessun errore JS in console durante tutto il giro.
 *
 * Autenticazione: password grant su Supabase + cookie @supabase/ssr forgiato, la
 * stessa tecnica di scripts/native-auth-check.mjs, con le fixture native-spine-test.
 *
 *   node scripts/settings-modal-check.mjs            # avvia da sé un dev server libero
 *   APP_BASE=http://localhost:5199 node scripts/settings-modal-check.mjs
 *
 * ponytail: asserzioni sequenziali, niente runner — la cosa più piccola che diventa
 * rossa quando la modal smette di aprirsi.
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

// ---- env (stessa convenzione degli altri script) ------------------------------------------
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
const PORT = Number(env.SETTINGS_MODAL_PORT ?? 5199);
let APP_BASE = env.APP_BASE ?? `http://localhost:${PORT}`;

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

// ---- dev server (avviato solo se non ce n'è già uno) ---------------------------------------
let devServer = null;
async function ensureServer() {
  if (await reachable(APP_BASE)) {
    console.log(`Dev server già in ascolto su ${APP_BASE}`);
    return;
  }
  console.log(`Avvio dev server su :${PORT} …`);
  devServer = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
    detached: false
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await reachable(APP_BASE)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`dev server non risponde su ${APP_BASE}`);
}
const stopServer = () => devServer?.kill('SIGTERM');

// ---- sessione vera, come in native-auth-check.mjs -----------------------------------------
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

// ---- il giro nel browser -------------------------------------------------------------------
async function run() {
  await ensureServer();
  const cookie = await authCookie();
  ok('sessione reale per la fixture', EMAIL);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies([cookie]);
  const page = await context.newPage();

  // Errori JS: raccolti e fatti fallire. Un corpo vuoto quasi sempre è un import morto.
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') jsErrors.push(m.text());
  });

  const home = `${APP_BASE}/app/${SLUG}`;
  await page.goto(home, { waitUntil: 'networkidle' });

  // Il banner cookie è un dialog fisso che intercetta i click: va tolto di mezzo,
  // esattamente come farebbe una persona, prima di provare la sidebar.
  const ccBtn = page.locator('.cc-actions .cc-btn').last();
  if (await ccBtn.count()) {
    await ccBtn.click();
    await page.locator('.cc').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  }
  assert(page.url().includes(`/app/${SLUG}`), '0. la home del brand carica', page.url());
  const urlBefore = page.url();

  // 1. l'ingranaggio nel footer della sidebar apre la modal.
  // Prima si aspetta che la modal sia VIVA: fino all'idratazione i link settings
  // sono link normali e navigherebbero (nessun JS può evitarlo). Una persona clicca
  // a pagina pronta; il test fa lo stesso invece di correre contro l'idratazione.
  await page
    .waitForFunction(() => document.documentElement.dataset.settingsModal === 'ready', {
      timeout: 30_000
    })
    .catch(() => fail('0b. la modal non si è mai registrata (idratazione?)'));
  const gear = page.locator('a.um-settings').first();
  await gear.waitFor({ state: 'visible', timeout: 15_000 });
  await gear.click();

  const dialog = page.locator('.sm-dialog');
  let appeared = true;
  try {
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    appeared = false;
  }
  assert(appeared, '1. click sull’ingranaggio → la modal compare');
  if (!appeared) {
    // Diagnosi utile: se l'URL è cambiato, il click ha NAVIGATO — cioè è arrivato
    // prima che l'app fosse idratata, ed è esattamente il "flash della pagina piena".
    console.error(`     url ora: ${page.url()} (era ${urlBefore})`);
    console.error('     errori JS:', jsErrors.slice(0, 5));
    await browser.close();
    return;
  }

  // 2. il rail elenca le sezioni
  const railItems = page.locator('.sm-rail .sm-item');
  const railCount = await railItems.count();
  assert(railCount >= 20, '2. il rail elenca le sezioni', `${railCount} voci`);

  // 3. il corpo contiene contenuto VERO della sezione (default: account collegati)
  const body = page.locator('.sm-body');
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.sm-body .settings');
      return !!el && el.textContent.trim().length > 40;
    },
    { timeout: 15_000 }
  ).catch(() => {});
  const firstText = (await body.innerText()).trim();
  const hasPanel = (await page.locator('.sm-body .panel').count()) > 0;
  assert(
    hasPanel && firstText.length > 40,
    '3. il corpo contiene la sezione vera (panel + testo)',
    `panel=${hasPanel}, ${firstText.length} char: ${JSON.stringify(firstText.slice(0, 70))}`
  );

  // 4. cambiare sezione dal rail cambia davvero il corpo
  const target = page.locator('.sm-rail .sm-item', { hasText: /^Fuso orario|^Posting timezone|^Time zone/i }).first();
  const targetExists = (await target.count()) > 0;
  const clicked = targetExists ? target : railItems.nth(railCount - 2);
  const clickedLabel = (await clicked.innerText()).trim();
  await clicked.click({ timeout: 60_000 });
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('.sm-body .settings');
      return !!el && el.textContent.trim().length > 20 && el.textContent.trim() !== prev;
    },
    firstText,
    { timeout: 15_000 }
  ).catch(() => {});
  const secondText = (await body.innerText()).trim();
  assert(
    secondText !== firstText && secondText.length > 20,
    '4. cambiando sezione il corpo cambia',
    `→ ${JSON.stringify(clickedLabel)}: ${JSON.stringify(secondText.slice(0, 70))}`
  );
  assert(page.url() === urlBefore, '4b. cambiare sezione NON tocca l’URL', page.url());

  // 4c. una sezione a DUE segmenti (`ads/accounts`) e una pesante del brand kit:
  // sono i due casi che il glob e la taglia della modal potrebbero sbagliare.
  for (const label of ['Ads accounts', 'Brand Kit']) {
    const item = page.locator('.sm-rail .sm-item', { hasText: label }).first();
    if (!(await item.count())) {
      console.log(`  SKIP  4c. "${label}" non nel rail (feature spenta per il brand)`);
      continue;
    }
    const before = (await body.innerText()).trim();
    await item.click({ timeout: 60_000 });
    await page
      .waitForFunction(
        (prev) => {
          const el = document.querySelector('.sm-body .settings');
          return !!el && el.textContent.trim().length > 20 && el.textContent.trim() !== prev;
        },
        before,
        { timeout: 20_000 }
      )
      .catch(() => {});
    const now = (await body.innerText()).trim();
    assert(
      now !== before && now.length > 20,
      `4c. la sezione "${label}" si carica nella modal`,
      JSON.stringify(now.slice(0, 60))
    );
  }

  // 5. Esc chiude e l'URL non è mai cambiato
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  const stillOpen = await dialog.isVisible().catch(() => false);
  assert(!stillOpen, '5. Esc chiude la modal');
  assert(page.url() === urlBefore, '5b. l’URL non è MAI cambiato', `${urlBefore} → ${page.url()}`);

  // 6. ⌘,/Ctrl+, riapre
  await page.keyboard.press('Control+Comma');
  const reopened = await dialog.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  assert(reopened, '6. Ctrl+, riapre la modal');
  await page.keyboard.press('Escape');

  // 7. la voce del menu utente (DropdownMenu portalato di bits-ui) apre la modal
  // `.um-trigger` è il DropdownMenu.Trigger del menu utente: il suo contenuto è
  // PORTALATO e si smonta alla selezione — è esattamente il percorso che prima
  // navigava alla pagina piena invece di aprire la modal.
  const userBtn = page.locator('.um-trigger').first();
  if ((await userBtn.count()) > 0) {
    await userBtn.click();
    const menuSettings = page.locator('a.um-link[href$="/settings"]').first();
    if ((await menuSettings.count()) > 0) {
      await menuSettings.click();
      const fromMenu = await dialog.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
      assert(fromMenu, '7. la voce nel menu utente (portale bits-ui) apre la modal');
      assert(page.url() === urlBefore, '7b. anche da lì l’URL resta fermo', page.url());
      await page.keyboard.press('Escape');
    } else {
      console.log('  SKIP  7. voce Impostazioni non trovata nel menu utente');
    }
  }

  // 9. un anchor QUALSIASI della pagina che punta ai settings (checklist, CTA, banner):
  // è il caso (a) dell'audit — nessun gancio esplicito, se lo prende l'intercettazione
  // globale. Se questa smettesse di esistere, questi link tornerebbero a navigare.
  const anyLink = page
    .locator(`a[href*="/app/${SLUG}/settings/"]:not(.sm-item):not([data-settings-full])`)
    .first();
  if (await anyLink.count()) {
    const href = await anyLink.getAttribute('href');
    await anyLink.click({ timeout: 30_000 });
    const opened = await dialog
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true, () => false);
    assert(opened, '9. un link settings qualsiasi apre la modal (intercettazione)', href ?? '');
    assert(page.url() === urlBefore, '9b. e non naviga', page.url());
    await page.keyboard.press('Escape');
  } else {
    console.log('  SKIP  9. nessun anchor settings sulla home di questo brand');
  }

  /**
   * L'impronta della CHROME che appartiene alla pagina viva: topbar globale (titolo,
   * sottotitolo, sezione, CTA), titolo del documento e voce evidenziata in sidebar.
   * Una pagina ospitata nella modal non deve poter cambiare NIENTE di questo: prima
   * scriveva in `pageMeta`/`pageTopActions`, che sono uno stato solo per tutta l'app.
   */
  const readShell = () =>
    page.evaluate(() => {
      const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
      return {
        title: txt('.page-topbar-title'),
        sub: txt('.page-topbar-sub'),
        section: txt('.page-topbar-section'),
        actions: txt('.page-topbar-actions'),
        avatar: !!document.querySelector('.page-topbar-avatar'),
        docTitle: document.title,
        nav: [...document.querySelectorAll("[data-sidebar='menu-button'][data-active='true']")]
          .map((e) => e.textContent.trim())
          .join(' | ')
      };
    });
  const sameShell = (a, b) =>
    ['title', 'sub', 'section', 'actions', 'avatar', 'docTitle', 'nav'].filter(
      (k) => a[k] !== b[k]
    );

  // 10-11. IL GIRO NON AGGIRABILE: la modal non ha una path propria e non sostituisce
  // la pagina da cui è stata aperta. Per ogni giro si marca il DOM della pagina viva,
  // si apre un target, e si pretende che (a) l'URL sia identico byte a byte, (b) il
  // nodo della pagina sottostante sia ANCORA lì, (c) chiudendo si torni a quella
  // stessa pagina viva, senza ricaricamenti (il marker su window non sopravvive a un
  // reload, quindi lo smaschera).
  async function roundTrip(label, startPath, targetSeg, groupLabel) {
    await page.goto(`${APP_BASE}/app/${SLUG}${startPath}`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000
    });
    const banner = page.locator('.cc-actions .cc-btn').last();
    if (await banner.count()) await banner.click().catch(() => {});
    const armed = await page
      .waitForFunction(() => document.documentElement.dataset.settingsModal === 'ready', {
        timeout: 90_000
      })
      .then(() => true, () => false);
    if (!armed) {
      fail(`${label}: la modal non si è armata su ${startPath || '/'}`);
      return;
    }
    await page.waitForTimeout(1500);
    // Ogni giro naviga davvero a `startPath`: le fetch di polling in volo vengono
    // abortite e diventano "Failed to fetch". È rumore del banco di prova, non della
    // modal — si azzera QUI, così l'assert finale copre solo apertura/uso/chiusura.
    jsErrors.length = 0;

    // Impronta della pagina VIVA sotto: marker su window (muore a ogni reload) +
    // attributo sul nodo di contenuto (muore se la rotta viene sostituita).
    const under = await page.evaluate(() => {
      window.__alive = 'alive-' + Math.random().toString(36).slice(2);
      const el = document.querySelector('.content-shell') ?? document.querySelector('main');
      if (el) el.setAttribute('data-under-probe', '1');
      return { marker: window.__alive, text: (el?.innerText ?? '').trim().slice(0, 80) };
    });
    const urlAtStart = page.url();
    const shellBefore = await readShell();

    const link = page.locator(`a[href="/app/${SLUG}/${targetSeg}"]`).first();
    for (let i = 0; i < 5 && !(await link.isVisible().catch(() => false)); i++) {
      await page
        .locator('button', { hasText: groupLabel })
        .first()
        .click({ timeout: 20_000 })
        .catch(() => {});
      await page.waitForTimeout(800);
    }
    if (!(await link.isVisible().catch(() => false))) {
      console.log(`  SKIP  ${label}: link /${targetSeg} non raggiungibile da ${startPath || '/'}`);
      return;
    }
    await link.click({ timeout: 60_000 });

    const opened = await dialog
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true, () => false);
    assert(opened, `${label}: /${targetSeg} si apre nella modal`);
    if (!opened) {
      console.error(`     url ora: ${page.url()} (era ${urlAtStart}) — errori JS:`, jsErrors.slice(0, 3));
      return;
    }
    await page
      .waitForFunction(
        () => (document.querySelector('.sm-body')?.textContent ?? '').trim().length > 40,
        { timeout: 30_000 }
      )
      .catch(() => {});

    // (a) URL identico byte a byte
    assert(page.url() === urlAtStart, `${label}: URL identico byte a byte`, `${urlAtStart} → ${page.url()}`);
    // (b) la pagina sotto è ancora viva e non è stata ricaricata né sostituita
    const still = await page.evaluate(() => {
      const el = document.querySelector('[data-under-probe="1"]');
      return {
        marker: window.__alive ?? null,
        present: !!el,
        text: (el?.innerText ?? '').trim().slice(0, 80)
      };
    });
    assert(still.marker === under.marker, `${label}: nessun ricaricamento (marker vivo)`, String(still.marker));
    assert(still.present, `${label}: il nodo della pagina sottostante è ANCORA nel DOM`);
    assert(still.text === under.text, `${label}: la pagina sottostante è invariata`,
      JSON.stringify(still.text.slice(0, 40)));
    // il corpo della modal mostra davvero il target, non la pagina di partenza
    const modalText = (await body.innerText()).trim();
    assert(modalText.length > 40 && modalText !== under.text,
      `${label}: la modal mostra /${targetSeg}`, JSON.stringify(modalText.slice(0, 50)));

    // (d) la CHROME della pagina viva non è stata toccata dall'apertura.
    let diff = sameShell(shellBefore, await readShell());
    assert(diff.length === 0, `${label}: aprendo, la topbar sotto non cambia`,
      diff.length ? `${diff.join(',')} — era ${JSON.stringify(shellBefore.title)}` : shellBefore.title ?? '(vuota)');

    // (e) e nemmeno cambiando sezione DENTRO la modal — due volte, che è il gesto
    // segnalato dal proprietario ("cambio pagina nel modal e cambia la topbar sotto").
    // Solo pagine VERE del brand: le sezioni impostazioni non usano `PageHead` (ce l'ha
    // il loro +layout, che la modal non monta), quindi passare di lì non proverebbe
    // niente — è esattamente il difetto segnalato, che nasce da chi scrive `pageMeta`.
    const rail = page.locator(
      `.sm-rail .sm-item:not([data-settings-full]):not([href*="/settings"])`
    );
    const railN = await rail.count();
    let switches = 0;
    for (let i = 0; i < railN && switches < 2; i++) {
      const item = rail.nth(i);
      if (await item.evaluate((el) => el.classList.contains('active'))) continue;
      const prevBody = (await body.innerText()).trim();
      const itemLabel = (await item.innerText()).trim();
      await item.click({ timeout: 60_000 }).catch(() => {});
      const changed = await page
        .waitForFunction(
          (prev) => {
            const el = document.querySelector('.sm-body');
            const t = (el?.textContent ?? '').trim();
            return t.length > 40 && t !== prev;
          },
          prevBody,
          { timeout: 30_000 }
        )
        .then(() => true, () => false);
      if (!changed) continue;
      switches += 1;
      diff = sameShell(shellBefore, await readShell());
      assert(
        diff.length === 0,
        `${label}: cambio ${switches} (→ ${itemLabel}) non tocca la topbar sotto`,
        diff.length ? `sporcati: ${diff.join(',')}` : ''
      );
      assert(page.url() === urlAtStart, `${label}: cambio ${switches} non tocca l'URL`, page.url());
      // L'intestazione della modal deve dire DOVE si è: è lei che porta il titolo ora.
      const headTitle = (await page.locator('.sm-head h2').innerText()).trim();
      assert(
        headTitle.length > 0 && headTitle !== (shellBefore.title ?? ''),
        `${label}: l'intestazione della modal mostra la sezione aperta`,
        JSON.stringify(headTitle)
      );
    }
    assert(switches === 2, `${label}: due cambi di sezione dentro la modal`, `${switches}/2`);

    // (c) chiusura: si torna alla stessa pagina viva, senza navigazioni
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    const after = await page.evaluate(() => {
      const el = document.querySelector('[data-under-probe="1"]');
      return { marker: window.__alive ?? null, present: !!el, text: (el?.innerText ?? '').trim().slice(0, 80) };
    });
    assert(!(await dialog.isVisible().catch(() => false)), `${label}: Esc chiude`);
    assert(page.url() === urlAtStart, `${label}: dopo Esc URL ancora identico`, page.url());
    assert(after.marker === under.marker && after.present && after.text === under.text,
      `${label}: dopo Esc si è sulla stessa pagina viva`);
    const diffAfter = sameShell(shellBefore, await readShell());
    assert(
      diffAfter.length === 0,
      `${label}: dopo Esc la topbar è ancora quella della pagina viva`,
      diffAfter.length ? `sporcati: ${diffAfter.join(',')}` : (shellBefore.title ?? '(vuota)')
    );
  }

  // Due pagine di partenza diverse, due target diversi (il terzo giro parte da una chat,
  // che è la superficie dove `propose_open_tab` apre le pagine).
  await roundTrip('10', '', 'calendar', 'Social media');
  await roundTrip('11', '/analytics', 'radar', 'Automations');
  const threadHref = await page
    .locator(`a[href^="/app/${SLUG}/chat/"]`)
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (threadHref) {
    await roundTrip('12', threadHref.replace(`/app/${SLUG}`, ''), 'calendar', 'Social media');
  } else {
    console.log('  SKIP  12. nessun thread di chat da cui partire');
  }
  // 8. nessun errore JS in tutto il giro
  const noisy = jsErrors.filter((e) => !/favicon|Failed to load resource.*40[34]/i.test(e));
  assert(noisy.length === 0, '8. nessun errore JS in console', noisy.slice(0, 3).join(' | '));

  await browser.close();
}

try {
  await run();
} catch (err) {
  fail('lo script è esploso', err instanceof Error ? err.message : String(err));
} finally {
  stopServer();
}

console.log(failed ? '\nROSSO — nel browser la modal non fa quello che deve.' : '\nVERDE — provato in un browser vero.');
process.exit(failed ? 1 : 0);
