/**
 * Il render VERO, nella sandbox vera. Costa tempo macchina, quindi non gira mai per sbaglio:
 * senza `GRAPHIC_RENDER_LIVE=1` è skippato.
 *
 *   GRAPHIC_RENDER_LIVE=1 GRAPHIC_RENDERER=chromium \
 *     node --env-file=.env node_modules/.bin/vitest run src/lib/server/graphic-sandbox.live.test.ts
 *
 * Serve `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` (o un OIDC valido) — le stesse
 * credenziali che il motion usa. Con quelle gira anche da localhost: misurato 20.8s la prima volta
 * e 19.1s la seconda, che è il costo di una VM con lease breve, non di un render da 220ms.
 *
 * `GRAPHIC_RENDERER` va passato dall'AMBIENTE, non solo scritto in `.env`: sotto vitest
 * `$env/dynamic/private` non rilegge il file, e il flag risulterebbe spento con il test che passa
 * senza aver renderizzato niente.
 */
import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { renderGraphicWithChromium } from './design-render-chromium';

const BRAND = process.env.LIVE_BRAND_ID ?? '6859115e-df6a-40f3-846e-6c577faf0e9c';

it.skipIf(process.env.GRAPHIC_RENDER_LIVE !== '1')('una grafica vera, renderizzata nella sandbox', async () => {
  const source = `
const Graphic = () => (
  <div style={{ width: '100%', height: '100%', background: '#F9F9F9', padding: 76,
                display: 'grid', gridTemplateRows: 'auto 1fr auto', fontFamily: 'Helvetica, Arial, sans-serif' }}>
    <div style={{ letterSpacing: 6, fontSize: 26, color: '#86868b' }}>ANOMALIA / LEADS</div>
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div>
        <h1 style={{ fontSize: 'clamp(48px, 7vw, 96px)', lineHeight: 1.04, margin: 0,
                     textWrap: 'balance', color: '#111' }}>
          I TUOI PROSSIMI CLIENTI STANNO GIÀ CERCANDOCI.
        </h1>
        <p style={{ fontSize: 30, color: '#555', marginTop: 28, maxWidth: '82%' }}>
          Monitoraggio in tempo reale su Reddit, X, Threads e LinkedIn con bozze pronte all'uso.
        </p>
      </div>
    </div>
    <div style={{ fontSize: 28 }}>● leads.anomalia.so</div>
  </div>
);`;
  const t0 = Date.now();
  const out = await renderGraphicWithChromium(source, { width: 1080, height: 1080, brandId: BRAND });
  console.log(`esito: ${out ? `${out.png.length} bytes in ${Date.now() - t0}ms` : 'undefined (ripiego su satori)'}`);
  if (out) writeFileSync('/tmp/sandbox-graphic.png', out.png);
  expect(out).toBeTruthy();
}, 900_000);
