import { describe, expect, it, vi } from 'vitest';
import { wrapGraphicAsComposition } from './design-render-chromium';

describe('una grafica è un motion video da un fotogramma', () => {
	it('esporta le misure, perché è da quelle che la Composition è costruita', () => {
		// `ROOT_TSX` nel progetto di render legge width/height/fps/durationInFrames dagli export di
		// `Video.tsx`: senza, la grafica esce 1080×1080 qualunque cosa chiedesse: una 9:16
		// diventerebbe quadrata senza che nessun errore lo dica.
		const out = wrapGraphicAsComposition('const Graphic = () => <div/>;', 1080, 1920);
		expect(out).toContain('export const width = 1080;');
		expect(out).toContain('export const height = 1920;');
		expect(out).toContain('export const durationInFrames = 1;');
	});

	it('esporta di default il componente del modello, e regge un sorgente che non lo definisce', () => {
		expect(wrapGraphicAsComposition('const Graphic = () => <div/>;', 1080, 1080))
			.toContain("typeof Graphic !== 'undefined' ? Graphic");
	});
});

describe('il renderer non toglie mai la grafica', () => {
	it('spento di default: torna undefined e il chiamante ripiega su satori', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: {} }));
		const { renderGraphicWithChromium, chromiumGraphicsEnabled } = await import('./design-render-chromium');
		expect(chromiumGraphicsEnabled()).toBe(false);
		expect(await renderGraphicWithChromium('x', { width: 1080, height: 1080, brandId: 'b1' })).toBeUndefined();
		vi.doUnmock('$env/dynamic/private');
		vi.resetModules();
	});

	it('acceso ma senza sandbox su questo deploy: undefined, non un errore', async () => {
		// Un self-host senza credenziali VM non deve ritrovarsi post senza immagine.
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: { GRAPHIC_RENDERER: 'chromium' } }));
		vi.doMock('$lib/server/sandbox', () => ({ isSandboxConfigured: () => false }));
		const { renderGraphicWithChromium } = await import('./design-render-chromium');
		expect(await renderGraphicWithChromium('x', { width: 1080, height: 1080, brandId: 'b1' })).toBeUndefined();
		vi.doUnmock('$lib/server/sandbox');
		vi.doUnmock('$env/dynamic/private');
		vi.resetModules();
	});

	it('acceso ma il render fallisce: undefined, e il motivo nei log', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: { GRAPHIC_RENDERER: 'chromium' } }));
		vi.doMock('$lib/server/sandbox', () => ({ isSandboxConfigured: () => true }));
		vi.doMock('$lib/server/motion-video/render-tools', () => ({
			renderMotionStills: async () => ({ rendered: [], failures: [{ frame: 0, error: 'boom' }] })
		}));
		const { renderGraphicWithChromium } = await import('./design-render-chromium');
		expect(await renderGraphicWithChromium('x', { width: 1080, height: 1080, brandId: 'b1' })).toBeUndefined();
		vi.doUnmock('$lib/server/motion-video/render-tools');
		vi.doUnmock('$lib/server/sandbox');
		vi.doUnmock('$env/dynamic/private');
		vi.resetModules();
	});

	it('senza brand non parte: la sandbox è per brand', async () => {
		vi.resetModules();
		vi.doMock('$env/dynamic/private', () => ({ env: { GRAPHIC_RENDERER: 'chromium' } }));
		const { renderGraphicWithChromium } = await import('./design-render-chromium');
		expect(await renderGraphicWithChromium('x', { width: 1080, height: 1080 })).toBeUndefined();
		vi.doUnmock('$env/dynamic/private');
		vi.resetModules();
	});
});
