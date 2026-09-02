import { describe, expect, it } from 'vitest';

const { stripProviderRefs, carryImagesToContinuation } = await import('./provider-refs');

describe('stripProviderRefs — le parti immagine sopravvivono al giro', () => {
	it('un URL oggetto in una parte immagine resta fruibile dal modello', () => {
		const messages = [
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'Cosa vede nella img?' },
					{ type: 'image', image: new URL('https://cdn.example/a.jpeg') }
				]
			}
		];
		const out = stripProviderRefs(messages) as typeof messages;
		const img = (out[0].content as Array<{ type: string; image?: unknown }>)[1];
		expect(img.type).toBe('image');
		// URL oggetto o stringa https: extractUserImages legge entrambe. Un {} lo uccide.
		const image = img.image;
		const usable =
			typeof image === 'string' && /^https?:\/\//.test(image) ? true : image instanceof URL;
		expect(usable).toBe(true);
	});

	it('una data-URL (primo invio) resta identica', () => {
		const messages = [
			{ role: 'user', content: [{ type: 'image', image: 'data:image/png;base64,AAAA' }] }
		];
		const out = stripProviderRefs(messages) as typeof messages;
		expect((out[0].content as Array<{ image?: string }>)[0].image).toBe('data:image/png;base64,AAAA');
	});

	it('providerOptions e providerMetadata sparisono, il resto resta', () => {
		const messages = [
			{
				role: 'assistant',
				content: [{ type: 'text', text: 'ciao' }],
				providerOptions: { openai: { itemId: 'x' } },
				providerMetadata: { openai: { itemId: 'x' } }
			}
		];
		const out = stripProviderRefs(messages) as Array<Record<string, unknown>>;
		expect(out[0].providerOptions).toBeUndefined();
		expect(out[0].providerMetadata).toBeUndefined();
		expect(out[0].content).toEqual([{ type: 'text', text: 'ciao' }]);
	});
});

describe('carryImagesToContinuation — il rilancio non perde le immagini del turno', () => {
	const imagePart = { type: 'image', image: 'data:image/png;base64,AAAA' };

	it('il messaggio di continuazione porta le parti immagine dell’ultimo turno utente', () => {
		const messages = [
			{ role: 'assistant', content: 'prima risposta' },
			{ role: 'user', content: [{ type: 'text', text: 'guarda' }, imagePart] },
			{ role: 'assistant', content: [{ type: 'text', text: 'risposta' }] }
		];
		const msg = carryImagesToContinuation(messages, 'completa il lavoro') as {
			role: string;
			content: Array<{ type: string }>;
		};
		expect(msg.role).toBe('user');
		expect(msg.content[0].type).toBe('text');
		expect(msg.content.some((p) => p.type === 'image')).toBe(true);
	});

	it('senza immagini resta il testo nudo, com’era', () => {
		const messages = [{ role: 'user', content: 'solo testo' }];
		const msg = carryImagesToContinuation(messages, 'completa') as { content: string };
		expect(msg.content).toBe('completa');
	});
});
