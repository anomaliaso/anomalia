import { describe, expect, it, vi } from 'vitest';

/**
 * Il render vero apre Chromium e costa secondi: gira solo con GRAPHIC_RENDER_LIVE=1, come i test
 * kie. Quello che gira SEMPRE è il contratto — il flag e il ripiego — perché è la parte che, se si
 * rompe, toglie le grafiche invece di migliorarle.
 */
const LIVE = process.env.GRAPHIC_RENDER_LIVE === '1';

describe('il renderer Chromium è opt-in e non toglie mai la grafica', () => {
	it('spento di default: torna undefined, il chiamante ripiega su satori', async () => {
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		const { renderGraphicWithChromium, chromiumGraphicsEnabled } = await import('./design-render-chromium');
		expect(chromiumGraphicsEnabled()).toBe(false);
		expect(await renderGraphicWithChromium('const Graphic = () => <div/>;', { width: 1080, height: 1080 })).toBeUndefined();
		vi.doUnmock('$env/dynamic/private');
	});

	it('acceso ma rotto: torna undefined invece di lanciare', async () => {
		// Un renderer assente NON deve diventare un post senza immagine. Il ripiego e' il punto.
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: { GRAPHIC_RENDERER: 'chromium' } }));
		vi.doMock('@remotion/bundler', () => ({ bundle: async () => { throw new Error('no chromium here'); } }));
		const { renderGraphicWithChromium } = await import('./design-render-chromium');
		expect(await renderGraphicWithChromium('const Graphic = () => <div/>;', { width: 1080, height: 1080 })).toBeUndefined();
		vi.doUnmock('@remotion/bundler');
		vi.doUnmock('$env/dynamic/private');
		vi.resetModules();
	});
});

describe.skipIf(!LIVE)('Chromium rende il CSS che satori non regge', () => {
	it('grid, clamp e text-wrap escono impaginati', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: { GRAPHIC_RENDERER: 'chromium' } }));
		const { renderGraphicWithChromium } = await import('./design-render-chromium');
		const source = `
const Graphic = () => (
  <div style={{ width: '100%', height: '100%', background: '#F9F9F9', padding: 76,
                display: 'grid', gridTemplateRows: 'auto 1fr auto', fontFamily: 'Helvetica, Arial, sans-serif' }}>
    <div style={{ letterSpacing: 6, fontSize: 26, color: '#86868b' }}>ANOMALIA / LEADS</div>
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <h1 style={{ fontSize: 'clamp(48px, 7vw, 96px)', lineHeight: 1.04, margin: 0,
                   textWrap: 'balance', color: '#111' }}>
        I TUOI PROSSIMI CLIENTI STANNO GIÀ CERCANDOCI.
      </h1>
    </div>
    <div style={{ fontSize: 28 }}>● leads.anomalia.so</div>
  </div>
);`;
		const out = await renderGraphicWithChromium(source, { width: 1080, height: 1080 });
		expect(out, 'il render deve riuscire').toBeTruthy();
		expect(out!.png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
		// Una tela bianca pesa pochissimo: questa soglia distingue "reso" da "vuoto ma riuscito".
		expect(out!.png.length).toBeGreaterThan(20_000);
	}, 180_000);
});
