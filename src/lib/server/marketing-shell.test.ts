import { afterEach, describe, expect, it, vi } from 'vitest';

const fake: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: fake }));

const { hideMarketing, isMarketingRoute, marketingShellTarget } = await import('./marketing-shell');

afterEach(() => {
	delete fake.HIDE_MARKETING;
});

describe('hideMarketing', () => {
	it('spento di default: il hosted product non cambia', () => {
		expect(hideMarketing()).toBe(false);
	});

	it('stringa vuota o spazi valgono come non impostata', () => {
		fake.HIDE_MARKETING = '   ';
		expect(hideMarketing()).toBe(false);
	});

	it('1 / true / yes, qualunque casing', () => {
		for (const v of ['1', 'true', 'TRUE', 'yes', 'Yes']) {
			fake.HIDE_MARKETING = v;
			expect(hideMarketing(), v).toBe(true);
		}
	});

	it('0 / false / garbage non accendono niente', () => {
		for (const v of ['0', 'false', 'no', 'on', 'hide']) {
			fake.HIDE_MARKETING = v;
			expect(hideMarketing(), v).toBe(false);
		}
	});
});

describe('isMarketingRoute', () => {
	it('homepage, pricing e il resto del gruppo locale', () => {
		expect(isMarketingRoute('/[[lang=locale]]')).toBe(true);
		expect(isMarketingRoute('/[[lang=locale]]/pricing')).toBe(true);
		expect(isMarketingRoute('/[[lang=locale]]/docs/api')).toBe(true);
		expect(isMarketingRoute('/[[lang=locale]]/waitlist')).toBe(true);
		expect(isMarketingRoute('/[[lang=locale]]/tools/geo-audit')).toBe(true);
	});

	it('/start è il funnel della landing: senza landing non c’è', () => {
		expect(isMarketingRoute('/start')).toBe(true);
		expect(isMarketingRoute('/start/')).toBe(true);
	});

	it('app, auth, API, blog, admin, asset restano', () => {
		for (const id of [
			'/app',
			'/app/[brand]/chat/[thread]',
			'/login',
			'/auth/callback',
			'/oauth/authorize',
			'/cli/callback',
			'/api/status',
			'/api/v1/autopilot/tick',
			'/approve/[token]',
			'/admin/videos',
			'/blog/[site]',
			'/blog-preview/[id]',
			'/_site',
			'/_site/[slug]',
			'/robots.txt',
			'/sitemap.xml',
			'/status',
			'/l/[code]'
		]) {
			expect(isMarketingRoute(id), id).toBe(false);
		}
	});

	it('senza route.id non si indovina: un 404 resta un 404', () => {
		expect(isMarketingRoute(null)).toBe(false);
		expect(isMarketingRoute(undefined)).toBe(false);
		expect(isMarketingRoute('')).toBe(false);
	});
});

describe('marketingShellTarget', () => {
	it('flag spenta: nessuna rotta si muove, nemmeno la homepage', () => {
		expect(marketingShellTarget('/[[lang=locale]]')).toBeNull();
		expect(marketingShellTarget('/[[lang=locale]]/pricing')).toBeNull();
		expect(marketingShellTarget('/start')).toBeNull();
	});

	it('flag accesa: il pitch va in /app, il resto no', () => {
		fake.HIDE_MARKETING = '1';
		expect(marketingShellTarget('/[[lang=locale]]')).toBe('/app');
		expect(marketingShellTarget('/[[lang=locale]]/pricing')).toBe('/app');
		expect(marketingShellTarget('/start')).toBe('/app');
		expect(marketingShellTarget('/app')).toBeNull();
		expect(marketingShellTarget('/login')).toBeNull();
		expect(marketingShellTarget('/_site')).toBeNull();
		expect(marketingShellTarget('/blog/[site]')).toBeNull();
	});
});

describe('il redirect vive in un posto solo', () => {
	it('hooks.server.ts usa marketingShellTarget, non un pathname indovinato', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync('src/hooks.server.ts', 'utf8');
		expect(src).toContain("from '$lib/server/marketing-shell'");
		expect(src).toContain('marketingShellTarget(event.route.id)');
		// Il pathname su un blog custom-domain è `/` — giudicarlo come marketing
		// manderebbe il sito del brand in /app. Deve restare route.id.
		expect(src).not.toMatch(/isMarketingRoute\(event\.url\.pathname\)/);
	});
});
