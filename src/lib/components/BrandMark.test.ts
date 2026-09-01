import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import BrandMark from './BrandMark.svelte';

describe('BrandMark', () => {
	it('renders a negative mark as one current color', () => {
		const { body } = render(BrandMark, { props: { tone: 'negative', size: 28 } });

		expect(body).toContain('fill="currentColor"');
		expect(body).not.toContain('<linearGradient');
	});

	it('keeps the gradient default and accessible SVG shape', () => {
		const { body } = render(BrandMark);

		expect(body).toContain('<linearGradient');
		expect(body).toContain('fill="url(#brandmark-gradient)"');
		expect(body).toContain('viewBox="0 0 947 464"');
		expect(body).toContain('aria-hidden="true"');
	});
});
