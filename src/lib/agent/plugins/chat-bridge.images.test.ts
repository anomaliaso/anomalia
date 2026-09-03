import { describe, expect, it } from 'vitest';
import { execChatTool } from './chat-bridge';

const toolReturning = (out: unknown) => ({ execute: async () => out }) as never;

describe('un tool di chat che produce un immagine la fa VEDERE al modello', () => {
	it('gli allegati diventano parti immagine, non testo', async () => {
		// Prima: execChatTool faceva JSON.stringify dell'intero ritorno. Un PNG allegato da un tool
		// finiva come base64 dentro una stringa — illeggibile per il modello e enorme. E' il motivo
		// per cui l'agente non ha mai guardato una grafica che aveva appena composto.
		const res = await execChatTool(
			toolReturning({ ok: true, _images: [{ mimeType: 'image/png', base64: 'AAAA' }] }),
			'design_graphic',
			{},
			'run1'
		);
		const kinds = res.content.map((c) => c.type);
		expect(kinds).toContain('image');
		expect(res.content.find((c) => c.type === 'image')).toMatchObject({ mimeType: 'image/png', base64: 'AAAA' });
	});

	it('e il base64 non finisce ANCHE nel testo', async () => {
		// Duplicarlo costerebbe token per una copia che il modello non puo' comunque leggere.
		const res = await execChatTool(
			toolReturning({ ok: true, _images: [{ mimeType: 'image/png', base64: 'SEGRETO' }] }),
			'design_graphic',
			{},
			'run1'
		);
		const text = res.content.find((c) => c.type === 'text');
		expect(text && 'text' in text ? text.text : '').not.toContain('SEGRETO');
		expect(text && 'text' in text ? text.text : '').toContain('"ok":true');
	});

	it('un tool senza allegati resta esattamente com era', async () => {
		const res = await execChatTool(toolReturning({ ok: true, post_id: 'p1' }), 'x', {}, 'run1');
		expect(res.content).toHaveLength(1);
		expect(res.content[0].type).toBe('text');
	});

	it('un errore resta un errore anche con un immagine allegata', async () => {
		const res = await execChatTool(
			toolReturning({ error: 'nope', _images: [{ mimeType: 'image/png', base64: 'AAAA' }] }),
			'x',
			{},
			'run1'
		);
		expect(res.isError).toBe(true);
	});
});
