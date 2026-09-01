import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('agent panel topbar action', () => {
	const page = read('../../routes/app/[brand]/chat/[thread]/+page.svelte');
	const cta = read('./TopbarCta.svelte');
	const topbar = read('./PageTopBar.svelte');

	it('uses a compact neutral variant without accent styling', () => {
		expect(page).toMatch(/variant="neutral"/);
		expect(cta).toMatch(/variant\?: 'primary' \| 'ghost' \| 'neutral'/);
		expect(cta).toMatch(/class:neutral=\{variant === 'neutral'\}/);
		expect(cta).toMatch(/\.topbar-cta\.neutral/);
		expect(topbar).toMatch(/:global\(\.topbar-cta\.neutral\)/);
	});

	it('keeps the accessible button toggle contract', () => {
		expect(page).toMatch(/type="button"/);
		expect(page).toMatch(/title=\{\$_\('chat\.computer\.toggle'\)\}/);
		expect(page).toMatch(/onclick=\{\(\) => \(agentPanelOpen = !agentPanelOpen\)\}/);
	});
});
