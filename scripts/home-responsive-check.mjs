/**
 * LA HOMEPAGE IN UN BROWSER VERO, a tre larghezze e in due temi.
 *
 * "Sembra responsive" letto nel CSS non è una verifica: le due sezioni nuove (TeamRoster,
 * HomeChatMockup) avevano due media query in tutto. Questo script apre la pagina a 390, 768
 * e 1440, in chiaro e in scuro, e diventa rosso se un visitatore vedrebbe un difetto:
 *
 *   1. scroll orizzontale (scrollWidth > clientWidth) — con l'elenco di chi sfora;
 *   2. testo tagliato (overflow nascosto senza ellissi dichiarata);
 *   3. le due sezioni nuove presenti, dentro il viewport e senza testo sotto gli 11px;
 *   4. nav utilizzabile — CTA in barra dove c'è, altrimenti burger + CTA dentro il menu;
 *   5. il submit dell'hero alto almeno 40px (bersaglio da pollice) e dentro lo schermo;
 *   6. nessuna sovrapposizione fra sezioni sorelle;
 *   7. nessun errore JS;
 *   8. il mockup della chat è interattivo: cinque tab, ognuna cambia la conversazione,
 *      aria-selected dichiarato, e le frecce muovono la selezione;
 *   8g/8h. il riquadro del mockup ha la STESSA altezza nei cinque casi (niente salti di
 *      layout) e a scorrere è la colonna dei messaggi, non la pagina;
 *   9. il video è largo quanto il mockup che gli sta sopra, e resta 16:9;
 *  10. la hero è alta quanto la viewport e il suo contenuto sta al centro (±2%) — dove ci
 *      sta; dove non ci sta, l'altezza cede e nulla viene tagliato.
 *
 * Lascia anche gli screenshot delle due sezioni in scripts/.shots (per l'occhio umano).
 *
 *   node scripts/home-responsive-check.mjs
 *   APP_BASE=http://localhost:5199 node scripts/home-responsive-check.mjs
 *
 * ponytail: asserzioni in fila, niente runner — la cosa più piccola che diventa rossa
 * quando la homepage smette di stare dentro un telefono.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const APP_BASE = process.env.APP_BASE ?? 'http://localhost:5199';
const SIZES = [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'tablet', width: 768, height: 1024, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false }
];
const OUT = process.env.OUT ?? new URL('.shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let failed = false;
const ok = (l, x='') => console.log(`  PASS  ${l}${x?` — ${x}`:''}`);
const fail = (l, x='') => { failed = true; console.error(`  FAIL  ${l}${x?` — ${x}`:''}`); };
const assert = (c,l,x='') => c?ok(l,x):fail(l,x);

const browser = await chromium.launch();
for (const theme of ['light','dark']) {
for (const s of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: 2,
    isMobile: s.mobile,
    hasTouch: s.mobile,
    colorScheme: theme
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await page.goto(APP_BASE + '/', { waitUntil: 'networkidle', timeout: 180000 });
  // banner cookie via
  const cc = page.locator('.cc-actions .cc-btn').last();
  if (await cc.count()) { await cc.click().catch(()=>{}); await page.locator('.cc').waitFor({state:'detached',timeout:4000}).catch(()=>{}); }
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e=>e.classList.add('in')));
  await page.waitForTimeout(700);

  // Il dev server ricarica a raffica quando un altro worktree tocca un tsconfig: l'idratazione
  // muore a metà e OGNI asserzione interattiva diventa rossa per un motivo che non è la pagina.
  // Una prova sola (il secondo tab risponde al click?) e un ricaricamento, poi si va avanti.
  const hydrated = async () => {
    const t = page.locator('.cm-threads [role="tab"]').nth(1);
    if (!(await t.count())) return false;
    await t.click().catch(() => {});
    await page.waitForTimeout(200);
    return (await t.getAttribute('aria-selected')) === 'true';
  };
  for (let i = 0; i < 3 && !(await hydrated()); i++) {
    console.log('     (idratazione non pronta, ricarico)');
    await page.reload({ waitUntil: 'networkidle', timeout: 180000 });
    await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e=>e.classList.add('in')));
    await page.waitForTimeout(900);
    errs.length = 0;
  }
  await page.locator('.cm-threads [role="tab"]').first().click().catch(() => {});
  await page.waitForTimeout(150);

  console.log(`\n== ${theme} / ${s.name} ${s.width}x${s.height} ==`);

  // 1. nessuno scroll orizzontale
  const sw = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  assert(sw.s <= sw.c, '1. nessuno scroll orizzontale', `scrollWidth=${sw.s} clientWidth=${sw.c}`);

  // 1b. chi sfora, se sfora
  if (sw.s > sw.c) {
    const bad = await page.evaluate((cw) => {
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > cw + 1 || r.left < -1) {
          out.push(`${el.tagName.toLowerCase()}.${(el.className||'').toString().split(' ').filter(Boolean).slice(0,3).join('.')} [${Math.round(r.left)}→${Math.round(r.right)}]`);
        }
        if (out.length > 12) break;
      }
      return out;
    }, sw.c);
    console.error('     sforano:', bad.join('\n               '));
  }

  // 2. niente testo tagliato (scrollWidth > clientWidth su nodi di testo con ellipsis/overflow)
  const clipped = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('main *, section *')) {
      if (el.children.length) continue;
      const t = (el.textContent||'').trim();
      if (!t) continue;
      const cs = getComputedStyle(el);
      if (el.closest('.sr-only') || el.classList.contains('sr-only')) continue;
      if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') continue;
      if (cs.overflow === 'visible' && cs.textOverflow !== 'ellipsis') continue;
      if (el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis')
        out.push(`${el.tagName.toLowerCase()}.${el.className}: ${JSON.stringify(t.slice(0,40))}`);
      if (el.scrollHeight > el.clientHeight + 2 && cs.overflowY === 'hidden')
        out.push(`Vclip ${el.tagName.toLowerCase()}.${el.className}: ${JSON.stringify(t.slice(0,40))}`);
    }
    return out.slice(0,10);
  });
  assert(clipped.length === 0, '2. nessun testo tagliato', clipped.join(' | '));

  // 3. i due componenti nuovi esistono e sono leggibili
  for (const [label, sel] of [['TeamRoster','.team-sec'],['HomeChatMockup','.chat-sec']]) {
    const box = await page.locator(sel).boundingBox().catch(()=>null);
    assert(!!box && box.width > 100 && box.height > 100, `3. ${label} renderizzato`, box?`${Math.round(box.width)}x${Math.round(box.height)}`:'assente');
    if (box) assert(box.width <= sw.c + 1, `3b. ${label} dentro il viewport`, `${Math.round(box.width)} <= ${sw.c}`);
  }
  // 3c. font-size minimo nei due componenti
  const tiny = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.team-sec *, .chat-sec *')) {
      if (el.children.length || !(el.textContent||'').trim()) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 11) out.push(`${el.className||el.tagName}: ${fs}px`);
    }
    return [...new Set(out)].slice(0,6);
  });
  assert(tiny.length === 0, '3c. nessun testo sotto 11px nei componenti nuovi', tiny.join(', '));

  // 4. nav utilizzabile
  const navBox = await page.locator('header.nav').boundingBox().catch(()=>null);
  assert(!!navBox, '4. nav presente');
  const navCta = page.locator('header.nav a.nav-cta').first();
  const ctaBox = await navCta.boundingBox().catch(()=>null);
  if (ctaBox) {
    assert((ctaBox.x + ctaBox.width) <= sw.c + 1 && ctaBox.height >= 28, '4b. CTA nav raggiungibile',
      `${Math.round(ctaBox.width)}x${Math.round(ctaBox.height)} right=${Math.round(ctaBox.x+ctaBox.width)}`);
  } else {
    // Su telefono la CTA della barra e' nascosta per progetto: la porta il menu.
    const burger = page.locator('header.nav button.nav-burger').first();
    const b = await burger.boundingBox().catch(()=>null);
    assert(!!b && b.width>=36 && b.height>=36, '4b. burger toccabile (CTA nel menu)', b?`${Math.round(b.width)}x${Math.round(b.height)}`:'assente');
    if (b) {
      await burger.click();
      const dlgCta = page.locator('.nav-dialog a').filter({ hasText: /start|inizia|get started|waitlist/i }).first();
      const db = await dlgCta.boundingBox().catch(()=>null);
      assert(!!db && db.height >= 40, '4c. CTA dentro il menu mobile', db?`${Math.round(db.width)}x${Math.round(db.height)}`:'assente');
      await page.keyboard.press('Escape').catch(()=>{});
      await page.waitForTimeout(300);
    }
  }

  // 5. CTA principale (hero url field + submit) raggiungibile col pollice
  const submit = page.locator('.gr-actions button[type="submit"], .gr-actions button').first();
  if (await submit.count()) {
    const b = await submit.boundingBox();
    assert(!!b && b.height >= 40 && (b.x+b.width) <= sw.c+1, '5. submit hero >= 40px e dentro', b?`${Math.round(b.width)}x${Math.round(b.height)} right=${Math.round(b.x+b.width)}`:'');
  } else fail('5. submit hero non trovato');

  // 10. HERO centrata verticalmente nella viewport. A 390 il contenuto e' piu' alto dello
  //     schermo: li' il centramento deve solo NON tagliare nulla, non forzare la meta'.
  // La sonda di idratazione clicca le tab e porta la pagina a meta' scroll; getBoundingClientRect
  // e' relativo alla viewport, quindi senza tornare in cima la hero si misurerebbe a -2000px.
  // behavior:'instant' e non il default: landing.css mette `scroll-behavior: smooth` su html,
  // e un'animazione di 2400px non finisce dentro l'attesa.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 }).catch(() => {});
  const hero = await page.evaluate(() => {
    const sec = document.querySelector('.gr-hero');
    const inner = document.querySelector('.gr-hero-inner');
    if (!sec || !inner) return null;
    const r = inner.getBoundingClientRect(), sr = sec.getBoundingClientRect();
    return { mid: r.top + r.height / 2, h: r.height, secH: sr.height, top: r.top, vh: innerHeight };
  });
  if (!hero) fail('10. hero non trovata');
  else if (hero.h + 112 <= hero.vh) {
    const off = Math.abs(hero.mid - hero.vh / 2) / hero.vh;
    assert(off <= 0.02, '10. hero centrata verticalmente nella viewport',
      `centro=${Math.round(hero.mid)} metà=${Math.round(hero.vh / 2)} scarto=${(off * 100).toFixed(2)}%`);
    assert(hero.secH >= hero.vh - 1, '10b. la hero alta quanto la viewport',
      `${Math.round(hero.secH)} >= ${hero.vh}`);
  } else {
    // Contenuto piu' alto dello schermo: l'altezza minima cede e si scorre. Quello che NON
    // deve succedere e' che la centratura spinga il titolo sopra il bordo (top negativo).
    assert(hero.top >= -1, '10. hero piu\' alta della viewport: nulla tagliato in cima',
      `top=${Math.round(hero.top)} contenuto=${Math.round(hero.h)} viewport=${hero.vh}`);
  }
  // 10c. il titolo non finisce sotto la barra fissa
  const navH = await page.evaluate(() => document.querySelector('header.nav')?.getBoundingClientRect().height ?? 0);
  const h1Top = await page.evaluate(() => document.querySelector('.gr-hero h1')?.getBoundingClientRect().top ?? 0);
  assert(h1Top >= navH - 1, '10c. il titolo non passa sotto la barra fissa', `h1.top=${Math.round(h1Top)} nav=${Math.round(navH)}`);

  // 6. sovrapposizioni grossolane fra sezioni sorelle
  const overlap = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('main > section, main > * > section')];
    const out = [];
    for (let i=1;i<secs.length;i++){
      const a = secs[i-1].getBoundingClientRect(), b = secs[i].getBoundingClientRect();
      if (b.top < a.bottom - 4) out.push(`${secs[i-1].className} ↔ ${secs[i].className}`);
    }
    return out;
  });
  assert(overlap.length === 0, '6. sezioni non sovrapposte', overlap.join(' | '));

  // 8. il mockup e' INTERATTIVO: cinque tab, il click cambia la conversazione, le frecce
  //    muovono la selezione, e lo stato selezionato e' dichiarato (aria-selected).
  const tabsL = page.locator('.cm-threads [role="tab"]');
  const nTabs = await tabsL.count();
  assert(nTabs === 5, '8. cinque casi d\'uso nella sidebar', String(nTabs));
  const readPanel = () => page.locator('#cm-panel').innerText();
  const seen = new Set();
  const heights = [];
  for (let i = 0; i < nTabs; i++) {
    await tabsL.nth(i).click();
    await page.waitForTimeout(180);
    const txt = (await readPanel()).trim();
    const sel = await tabsL.nth(i).getAttribute('aria-selected');
    assert(sel === 'true', `8${String.fromCharCode(97+i)}. tab ${i+1}: aria-selected dichiarato`, String(sel));
    assert(txt.length > 80 && !seen.has(txt), `8${String.fromCharCode(97+i)}. tab ${i+1}: conversazione diversa`, JSON.stringify(txt.slice(0,44)));
    seen.add(txt);
    const box = await page.locator('.cm').boundingBox();
    assert(!!box && box.width <= sw.c + 1, `8${String.fromCharCode(97+i)}. tab ${i+1}: il riquadro resta dentro`, box?String(Math.round(box.width)):'');
    heights.push(box ? box.height : -1);
  }
  // 8g. ALTEZZA FISSA: cambiando caso la pagina sotto non si muove. Se il riquadro si adatta al
  //     caso piu' lungo, questa e' l'asserzione che diventa rossa.
  const hSpread = Math.max(...heights) - Math.min(...heights);
  assert(hSpread <= 1, '8g. il riquadro ha la stessa altezza nei cinque casi',
    `${heights.map((h) => Math.round(h)).join(' / ')} — spread ${hSpread.toFixed(2)}px`);
  // 8h. e a scorrere e' la colonna dei messaggi, non la pagina: sul caso piu' alto il thread
  //     deve avere overflow proprio, altrimenti l'altezza fissa taglierebbe il testo.
  const thread = await page.evaluate(() => {
    const el = document.querySelector('.cm-thread');
    return el ? { oy: getComputedStyle(el).overflowY, sh: el.scrollHeight, ch: el.clientHeight } : null;
  });
  assert(!!thread && thread.oy === 'auto', '8h. la conversazione scorre dentro il pannello',
    thread ? `overflow-y=${thread.oy} ${thread.sh}/${thread.ch}` : 'assente');
  // tastiera: freccia dalla prima tab porta alla seconda e la mette a fuoco
  await tabsL.nth(0).click();
  await tabsL.nth(0).focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  const focusedIdx = await page.evaluate(() =>
    [...document.querySelectorAll('.cm-threads [role="tab"]')].findIndex((e) => e === document.activeElement)
  );
  assert(focusedIdx === 1, '8f. le frecce muovono la selezione', String(focusedIdx));

  // 9. il video ha la STESSA larghezza del mockup che gli sta sopra (il confronto visivo che
  //    si nota davvero: la homepage non ha una max-width unica).
  const vw = await page.locator('.video-sec .video-wrap').boundingBox().catch(() => null);
  const cmw = await page.locator('.cm').boundingBox().catch(() => null);
  assert(!!vw && !!cmw && Math.abs(vw.width - cmw.width) <= 1, '9. video largo quanto il mockup',
    vw && cmw ? `video=${vw.width.toFixed(1)} mockup=${cmw.width.toFixed(1)}` : 'assente');
  // 9b. e resta 16:9, che e' l'altra meta' della richiesta.
  const yt = await page.locator('.video-sec .yt-facade, .video-sec iframe').first().boundingBox().catch(() => null);
  assert(!!yt && Math.abs(yt.width / yt.height - 16 / 9) < 0.03, '9b. player 16:9',
    yt ? `${Math.round(yt.width)}x${Math.round(yt.height)} = ${(yt.width / yt.height).toFixed(3)}` : 'assente');

  const noisy = errs.filter(e => !/favicon|Failed to load resource|net::ERR|posthog|seline|WebSocket|ws:\/\//i.test(e));
  assert(noisy.length === 0, '7. nessun errore JS', noisy.slice(0,3).join(' | '));

  // screenshot dei due componenti
  await page.locator('.team-sec').screenshot({ path: `${OUT}/${theme}-${s.name}-team.png` }).catch(()=>{});
  await page.locator('.chat-sec').screenshot({ path: `${OUT}/${theme}-${s.name}-chat.png` }).catch(()=>{});
  await page.locator('.video-sec').screenshot({ path: `${OUT}/${theme}-${s.name}-video.png` }).catch(()=>{});
  await ctx.close();
}
}
await browser.close();
console.log(failed ? '\nROSSO' : '\nVERDE');
process.exit(failed?1:0);
