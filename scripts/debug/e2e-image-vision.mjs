/**
 * GATE E2E — immagine allegata in chat, primo invio e REDO (turno ricostruito dalla history).
 *
 * Browser visibile, login reale, thread content NUOVO (agent=content via /chat/new) per non
 * ereditare l'inquinamento dei turni di verifica. L'immagine è disegnata a runtime (sfondo
 * rosso, testo bianco "A7X"): l'asserzione è che l'agente RIPORTI il testo — un agente cieco
 * dice di non vedere l'immagine. Il verdetto del kit può rilanciare un giro correttivo dopo
 * la risposta: per questo l'asserzione è «una riga assistant dopo il turno contiene il
 * marker», non «l'ultima riga».
 *
 * Uso: node scripts/debug/e2e-image-vision.mjs
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:5185';
const BRAND = 'demo';
const MARKER = 'A7X';
const TURN_TIMEOUT_MS = 300_000;

const psql = (sql) =>
  execFileSync('docker', ['exec', 'anomalia-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', sql], {
    encoding: 'utf8'
  });

const log = (...a) => console.log('[e2e]', ...a);
let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed = true;
};

const browser = await chromium.launch({ headless: false, slowMo: 100 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  // ── Login reale ─────────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('input[name="email"]').fill('test@anomalia.so');
  await page.locator('input[name="password"]').fill('123456');
  await page.locator('form[action="?/login"] button[type="submit"]').click({ timeout: 120_000 });
  await page.waitForURL(/\/app/, { timeout: 180_000 });
  check('login', page.url().includes('/app'), page.url());

  // ── Immagine di prova: canvas nel contesto pagina → PNG su disco ────────
  const dataUrl = await page.evaluate((mk) => {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 240;
    const x = c.getContext('2d');
    x.fillStyle = '#c0392b';
    x.fillRect(0, 0, 240, 240);
    x.fillStyle = '#ffffff';
    x.font = 'bold 72px sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(mk, 120, 120);
    return c.toDataURL('image/png');
  }, MARKER);
  const pngPath = '/tmp/e2e-attach.png';
  writeFileSync(pngPath, Buffer.from(dataUrl.split(',')[1], 'base64'));

  // ── Thread content NUOVO dal composer ───────────────────────────────────
  const t0 = new Date().toISOString();
  await page.goto(`${BASE}/app/${BRAND}/chat/new?agent=content`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea.ch-input', { timeout: 60_000 });
  await page
    .locator('textarea.ch-input')
    .fill(`Cosa c'è scritto nell'immagine allegata? Riporta ESATTAMENTE il testo che vedi.`);
  // Il downscale è async e l'idratazione del composer può rimontare l'input: si ritenta
  // finché la strip di preview non mostra l'allegato (il segnale che viaggerà col send).
  let attached = false;
  for (let i = 0; i < 5 && !attached; i++) {
    await page.locator('input[type="file"][accept*="image"]').first().setInputFiles(pngPath);
    attached = await page
      .locator('.ch-refs .ch-ref')
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
  }
  check('allegato in composer (strip visibile)', attached);
  await page.locator('button.ch-send[type="submit"]').click();
  log('primo invio partito…');

  // Il thread nasce al primo invio: aspetta il thread_id nuovo e la risposta.
  await page.waitForURL(/\/chat\//, { timeout: 60_000 });
  const threadId = page.url().split('/chat/')[1].split(/[?#]/)[0];
  check('thread content creato', /^[0-9a-f-]{36}$/.test(threadId), threadId);

  // ── Aspetta una riga assistant che contiene il marker (o un errore) ─────
  const waitMarker = async (sinceIso, label) => {
    const since = sinceIso.replace('T', ' ').replace('Z', '');
    const deadline = Date.now() + TURN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const out = psql(
        `select substr(replace(content, E'\\n', ' '), 1, 400) from chat_messages
         where thread_id = '${threadId}' and role = 'assistant'
           and created_at > '${since}'::timestamptz
           and content ILIKE '%${MARKER}%'
         limit 1;`
      ).trim();
      if (out) return out;
      const err = psql(
        `select substr(content, 1, 200) from chat_messages
         where thread_id = '${threadId}' and role = 'assistant'
           and created_at > '${since}'::timestamptz
           and (content ILIKE '%Errore del turno%' OR content ILIKE '%Turn error%')
         limit 1;`
      ).trim();
      if (err) return null;
      await new Promise((r) => setTimeout(r, 4000));
    }
    return null;
  };

  const firstText = await waitMarker(t0, 'primo invio');
  check('primo invio: l’agente legge il testo dell’immagine', !!firstText, (firstText ?? 'NESSUNA RISPOSTA').slice(0, 160));

  // ── REDO: il turno ricostruito dalla history (IL PERCORSO DEL BUG) ──────
  const beforeRedo = new Date().toISOString();
  await page.waitForTimeout(2500); // hydratazione delle azioni messaggio
  const redoBtns = page.locator('button[aria-label="Rigenera"]');
  check('bottone Rigenera presente', (await redoBtns.count()) >= 1);
  await redoBtns.first().click();
  log('redo partito…');

  const redoText = await waitMarker(beforeRedo, 'redo');
  check('redo: l’agente legge ANCORA l’immagine', !!redoText, (redoText ?? 'NESSUNA RISPOSTA').slice(0, 160));

  // ── Persistenza dopo reload ─────────────────────────────────────────────
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea.ch-input', { timeout: 60_000 });
  const bodyText = await page.evaluate(() => document.body.innerText);
  check('risposta visibile in pagina dopo reload', bodyText.toUpperCase().includes(MARKER));
} catch (e) {
  failed = true;
  console.log('[e2e] ERRORE:', e.message?.slice(0, 400));
} finally {
  await page.screenshot({ path: '/tmp/e2e-final.png', fullPage: true }).catch(() => {});
  await browser.close();
}
console.log(failed ? '=== GATE ROSSO ===' : '=== GATE VERDE ===');
process.exit(failed ? 1 : 0);
