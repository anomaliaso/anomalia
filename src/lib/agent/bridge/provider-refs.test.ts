import { describe, expect, it } from 'vitest';

const { stripProviderRefs } = await import('./provider-refs');

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
