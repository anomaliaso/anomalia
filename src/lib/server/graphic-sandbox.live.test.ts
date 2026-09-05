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
import { createHash } from 'node:crypto';
import { renderGraphicWithChromium } from './design-render-chromium';
import { renderGraphicStill, renderGraphicStills } from './motion-video/render-tools';

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

it.skipIf(process.env.GRAPHIC_RENDER_LIVE !== '1')(
  'il bundle cachato NON serve il sorgente precedente',
  async () => {
    // Il difetto che questo test esiste per non far tornare: un bundle che importa `./Video` e'
    // stantio appena il sorgente cambia — misurato, due sorgenti diversi davano PNG IDENTICI. La
    // composizione `Graphic` riceve il sorgente come PROP proprio per questo, e il bundle e'
    // cachato solo perche' non lo contiene.
    const g = (bg: string) =>
      `const Graphic = () => <div style={{width:'100%',height:'100%',background:'${bg}',display:'flex'}}>x</div>;`;
    const h = (b: Buffer) => createHash('sha1').update(b).digest('hex');
    const a = await renderGraphicStill({ brandId: BRAND, source: g('#ff0000'), width: 1080, height: 1080 });
    const b = await renderGraphicStill({ brandId: BRAND, source: g('#0000ff'), width: 1080, height: 1920 });
    expect('png' in a && 'png' in b, JSON.stringify([a, b]).slice(0, 300)).toBe(true);
    if ('png' in a && 'png' in b) expect(h(a.png)).not.toBe(h(b.png));
  },
  900_000
);

it.skipIf(process.env.GRAPHIC_RENDER_LIVE !== '1')(
  'quattro grafiche su UNA sandbox, tutte distinte',
  async () => {
    // Il numero che giustifica il plurale: misurato, quattro grafiche in 22.9s su una apertura
    // sola, contro ~67s facendole una per volta (17s l'una, di cui ~14 di apertura e chiusura).
    // E l'isolamento: un fallimento su una slide non porta via le altre.
    const g = (bg: string) => ({
      source: `const Graphic = () => <div style={{width:'100%',height:'100%',background:'${bg}',display:'flex'}}>x</div>;`,
      width: 1080,
      height: 1080
    });
    const out = await renderGraphicStills({
      brandId: BRAND,
      graphics: [g('#ff0000'), g('#00ff00'), g('#0000ff'), g('#ffff00')]
    });
    expect(out).toHaveLength(4);
    expect(out.every((o) => 'png' in o), JSON.stringify(out).slice(0, 300)).toBe(true);
    const hashes = out.map((o) => ('png' in o ? createHash('sha1').update(o.png).digest('hex') : ''));
    expect(new Set(hashes).size, 'quattro sorgenti diversi, quattro PNG diversi').toBe(4);
  },
  900_000
);
