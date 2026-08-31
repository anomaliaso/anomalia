import { describe, it, expect, vi, afterEach } from 'vitest';
import { blockPageReason, classifyArchetype, discoverAnnouncementPages, discoverInternalPages, extractLogos, extractSocialHandles, harvestPageImages, isUrlSafe, loadPageHtml, matchTeamPhotos, resolveEntryUrl, svgToPng, type BrowserRenderer, type EntryProbe } from './brand-analysis';

const linksHtml = (hrefs: string[]) =>
    `<html><body>${hrefs.map((h) => `<a href="${h}">x</a>`).join('')}</body></html>`;

describe('discoverInternalPages — non-ecommerce archetypes', () => {
    const base = 'https://example.com';

    it('discovers portfolio, SaaS and local-service pages, not just ecommerce ones', () => {
        const found = discoverInternalPages(
            linksHtml(['/work', '/projects', '/use-cases', '/customers', '/menu', '/case-studies/acme']),
            base
        );
        expect(found).toEqual(
            expect.arrayContaining([
                'https://example.com/work',
                'https://example.com/projects',
                'https://example.com/use-cases',
                'https://example.com/customers',
                'https://example.com/menu',
                'https://example.com/case-studies/acme'
            ])
        );
    });

    it('still excludes blog/legal/auth and external links', () => {
        const found = discoverInternalPages(
            linksHtml(['/blog/post', '/privacy', '/login', 'https://other.com/work']),
            base
        );
        expect(found).toEqual([]);
    });
});

describe('classifyArchetype', () => {
    it('detects ecommerce from cart/checkout signals', () => {
        expect(classifyArchetype('<a href="/cart">Cart</a><a href="/checkout">Pay</a>', '')).toBe('ecommerce');
        expect(classifyArchetype('<button>Add to cart</button>', '')).toBe('ecommerce');
    });

    it('detects saas from pricing + signup/app/docs', () => {
        const html = '<a href="/pricing">Pricing</a><a href="https://app.acme.com">Login</a><a href="/docs">Docs</a>';
        expect(classifyArchetype(html, 'Start free trial of our software platform')).toBe('saas');
    });

    it('detects portfolio from work/case-study + creative wording', () => {
        expect(classifyArchetype('<a href="/case-study/aria">', 'a creative studio crafting brand identities')).toBe('portfolio');
    });

    it('detects local_service from menu/booking + place words', () => {
        expect(classifyArchetype('<a href="/menu">Menu</a><a href="tel:+393401234">', 'our restaurant in Rome — book a table')).toBe('local_service');
    });

    it('detects creator from blog/newsletter + subscribe', () => {
        expect(classifyArchetype('<a href="/newsletter">Newsletter</a>', 'subscribe for my latest videos')).toBe('creator');
    });

    it('falls back to generic with no clear signals', () => {
        expect(classifyArchetype('<div>Welcome to our website</div>', 'we make good things happen')).toBe('generic');
    });
});

describe('discoverAnnouncementPages', () => {
    const base = 'https://example.com';
    it('finds announcement sections (locale-aware), prefers index pages, ignores brand/external pages', () => {
        const found = discoverAnnouncementPages(
            linksHtml(['/blog', '/blog/some-post', '/en/changelog', '/about', '/pricing', '/releases', 'https://ext.com/blog']),
            base
        );
        expect(found).toEqual(
            expect.arrayContaining(['https://example.com/blog', 'https://example.com/releases', 'https://example.com/en/changelog'])
        );
        expect(found).not.toContain('https://example.com/about');
        expect(found.find((u) => u.includes('ext.com'))).toBeUndefined();
        expect(found.length).toBeLessThanOrEqual(3);
    });

    it('returns [] when there is no announcement section', () => {
        expect(discoverAnnouncementPages(linksHtml(['/about', '/pricing', '/contact']), base)).toEqual([]);
    });
});

describe('extractLogos', () => {
    it('detects a logo by its src filename and keeps og:image as a last-resort, excludes favicons', () => {
        const html = `<head><meta property="og:image" content="https://cdn.x/screenshot-preview.png"></head>
            <body><img src="/assets/logo-mellon.png"><img class="ico" src="/assets/favicon-logo.png"></body>`;
        const logos = extractLogos(html, 'https://mellon.com');
        expect(logos[0]).toEqual({ url: 'https://mellon.com/assets/logo-mellon.png', type: 'html-img-src' });
        expect(logos.some((l) => l.type === 'og-image')).toBe(true);
        expect(logos.find((l) => l.url.includes('favicon'))).toBeUndefined();
    });
});

describe('extractSocialHandles', () => {
    it('maps footer social links to platform + handle, skipping share/intent/relative', () => {
        const html = `
            <a href="https://www.instagram.com/acme.studio/">IG</a>
            <a href="https://www.tiktok.com/@acme">TT</a>
            <a href="https://x.com/acme_hq">X</a>
            <a href="https://www.linkedin.com/company/acme-inc">LI</a>
            <a href="https://www.youtube.com/@AcmeChannel">YT</a>
            <a href="https://twitter.com/intent/tweet?text=hi">share</a>
            <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
            <a href="/about">about</a>
            <a href="https://www.instagram.com/acme.studio">dup</a>
        `;
        const out = extractSocialHandles(html);
        expect(out).toEqual([
            { platform: 'instagram', handle: 'acme.studio', url: 'https://www.instagram.com/acme.studio/' },
            { platform: 'tiktok', handle: 'acme', url: 'https://www.tiktok.com/@acme' },
            { platform: 'x', handle: 'acme_hq', url: 'https://x.com/acme_hq' },
            { platform: 'linkedin', handle: 'acme-inc', url: 'https://www.linkedin.com/company/acme-inc' },
            { platform: 'youtube', handle: 'AcmeChannel', url: 'https://www.youtube.com/@AcmeChannel' }
        ]);
    });

    it('handles short/alias domains and treats twitter.com as x', () => {
        const html = `
            <a href="https://instagr.am/acme">IG short</a>
            <a href="https://twitter.com/acmehq">tw</a>
            <a href="https://fb.com/acmepage">fb short</a>
        `;
        const out = extractSocialHandles(html);
        expect(out).toEqual([
            { platform: 'instagram', handle: 'acme', url: 'https://instagr.am/acme' },
            { platform: 'x', handle: 'acmehq', url: 'https://twitter.com/acmehq' },
            { platform: 'facebook', handle: 'acmepage', url: 'https://fb.com/acmepage' }
        ]);
    });

    it('returns [] when the site links no socials', () => {
        expect(extractSocialHandles('<a href="mailto:x@y.com">mail</a><a href="/contact">c</a>')).toEqual([]);
    });
});

describe('svgToPng', () => {
    it('rasterises an SVG to a valid PNG buffer', async () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#0099FF"/></svg>';
        const png = await svgToPng(svg);
        expect(png).not.toBeNull();
        // PNG magic number.
        expect(png!.subarray(0, 4).toString('hex')).toBe('89504e47');
    });
});

describe('matchTeamPhotos', () => {
    const images = [
        'https://withmellon.com/images/team/marco-di-franco.jpg',
        'https://withmellon.com/images/team/yamil-marquez.jpg',
        'https://withmellon.com/images/nordic-health-hero.jpg'
    ];

    it('matches a person to their photo by full name-slug', () => {
        const out = matchTeamPhotos([{ name: 'Marco Di Franco', role: 'Founder' }], images);
        expect(out[0]).toEqual({
            name: 'Marco Di Franco',
            role: 'Founder',
            image: 'https://withmellon.com/images/team/marco-di-franco.jpg',
            images: ['https://withmellon.com/images/team/marco-di-franco.jpg']
        });
    });

    it('returns EVERY photo matching a person, not just the first', () => {
        const imgs = [
            'https://e.com/images/team/marco-di-franco.jpg',
            'https://e.com/images/team/marco-di-franco-2.jpg',
            'https://e.com/images/team-marco.webp',
            'https://e.com/images/nordic-health-hero.jpg'
        ];
        const out = matchTeamPhotos([{ name: 'Marco Di Franco' }], imgs);
        expect(out[0].images).toEqual([
            'https://e.com/images/team/marco-di-franco.jpg',
            'https://e.com/images/team/marco-di-franco-2.jpg',
            'https://e.com/images/team-marco.webp'
        ]);
        expect(out[0].image).toBe('https://e.com/images/team/marco-di-franco.jpg');
    });

    it('keeps a person without a matching photo (imageless), never mis-assigns', () => {
        const out = matchTeamPhotos([{ name: 'Sofia Bianchi' }], images);
        expect(out[0]).toEqual({ name: 'Sofia Bianchi', role: undefined, image: undefined });
    });

    it('does not attach an unrelated hero image to a person (common word, no team hint)', () => {
        const out = matchTeamPhotos([{ name: 'Nordic Person' }], ['https://e.com/images/nordic-health-hero.jpg']);
        expect(out[0].image).toBeUndefined();
    });

    it('matches a first-name-only team filename when it carries a team hint', () => {
        const imgs = ['https://e23.ai/images/team-giuseppe.webp', 'https://e23.ai/images/team-alessandro.webp'];
        const out = matchTeamPhotos(
            [{ name: 'Giuseppe Vulduraro' }, { name: 'Alessandro Lo Piano' }],
            imgs
        );
        expect(out[0].image).toBe('https://e23.ai/images/team-giuseppe.webp');
        expect(out[1].image).toBe('https://e23.ai/images/team-alessandro.webp');
    });
});

describe('harvestPageImages', () => {
    const base = 'https://example.com';

    it('collects content images, resolves relative URLs, dedups, drops icons/logos/sprites/data-URIs', () => {
        const html = `
            <img src="/images/nordic-health-hero.jpg">
            <img data-src="/images/team/marco.jpg">
            <img src="/assets/logo-mellon.png">
            <img src="/icons/menu.svg">
            <img src="/images/sprite-sheet.png">
            <img src="data:image/png;base64,AAAA">
            <img src="https://cdn.tracking.com/pixel.gif">
            <img src="/images/nordic-health-hero.jpg">
            <source srcset="/images/case-1-small.jpg 480w, /images/case-1-large.jpg 1200w">
            <div style="background-image: url('/images/studio-bg.jpg')"></div>
        `;
        const imgs = harvestPageImages(html, base);
        expect(imgs).toEqual([
            'https://example.com/images/nordic-health-hero.jpg',
            'https://example.com/images/team/marco.jpg',
            'https://example.com/images/case-1-small.jpg',
            'https://example.com/images/studio-bg.jpg'
        ]);
    });

    it('returns [] for an empty SPA shell (no images until rendered)', () => {
        expect(harvestPageImages('<html><body><div id="app"></div></body></html>', base)).toEqual([]);
    });
});

describe('loadPageHtml — render-first when configured', () => {
    const richHtml = `<html><body>${'word '.repeat(60)}</body></html>`; // >100 chars of visible text
    const thinHtml = '<html><body><div id="app"></div></body></html>'; // SPA shell, ~0 visible text

    const mockStaticFetch = (body: string) =>
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                status: 200,
                ok: true,
                headers: { get: () => null },
                text: async () => body
            }))
        );

    // Injected fake browser — avoids real network and the SvelteKit/vitest module-mock quirk.
    const renderer = (cfg: { configured: boolean; content?: () => Promise<string> }): BrowserRenderer => ({
        isConfigured: () => cfg.configured,
        content: vi.fn(cfg.content ?? (async () => ''))
    });

    afterEach(() => vi.unstubAllGlobals());

    it('renders via the browser on EVERY site when configured — even when static is rich', async () => {
        mockStaticFetch(richHtml);
        const rendered = `<html><body>${'rendered '.repeat(60)}</body></html>`;
        const r = renderer({ configured: true, content: async () => rendered });
        const onEscalate = vi.fn();

        const out = await loadPageHtml('https://example.com', onEscalate, r);

        expect(out).toBe(rendered);
        expect(onEscalate).toHaveBeenCalledOnce();
        expect(r.content).toHaveBeenCalledWith('https://example.com', { waitForTimeout: 2500 });
    });

    it('returns static HTML (no render) when Browserless is not configured', async () => {
        mockStaticFetch(richHtml);
        const r = renderer({ configured: false });
        const out = await loadPageHtml('https://example.com', undefined, r);
        expect(out).toBe(richHtml);
        expect(r.content).not.toHaveBeenCalled();
    });

    it('falls back to static HTML if the render fails', async () => {
        mockStaticFetch(richHtml);
        const r = renderer({ configured: true, content: async () => { throw new Error('429'); } });
        const out = await loadPageHtml('https://example.com', undefined, r);
        expect(out).toBe(richHtml);
    });

    it('keeps the static HTML when the render comes back thinner', async () => {
        mockStaticFetch(richHtml);
        const r = renderer({ configured: true, content: async () => thinHtml });
        const out = await loadPageHtml('https://example.com', undefined, r);
        expect(out).toBe(richHtml);
    });

    // Il renderer esce da IP di datacenter e molte CDN li bloccano: torna una pagina di blocco,
    // non il sito. Ha centinaia di caratteri, quindi la soglia "pagina magra = SPA" la lascia
    // passare — e il brand veniva costruito sopra un errore 403 (illy.com, 31 agosto 2026).
    it('non scambia una pagina di blocco della CDN per il sito', async () => {
        mockStaticFetch(richHtml);
        const r = renderer({ configured: true, content: async () => CLOUDFRONT_BLOCK });
        const out = await loadPageHtml('https://example.com', undefined, r);
        expect(out).toBe(richHtml);
    });

    it('non restituisce niente quando anche la lettura diretta è bloccata', async () => {
        mockStaticFetch(CLOUDFRONT_BLOCK);
        const r = renderer({ configured: true, content: async () => CLOUDFRONT_BLOCK });
        const out = await loadPageHtml('https://example.com', undefined, r);
        expect(out).toBe('');
    });
});

const CLOUDFRONT_BLOCK = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<HTML><HEAD><TITLE>ERROR: The request could not be satisfied</TITLE></HEAD><BODY>
<H1>403 ERROR</H1><H2>The request could not be satisfied.</H2>
Request blocked. We can't connect to the server for this app or website at this time.
There might be too much traffic or a configuration error. Try again later, or contact
the app or website owner.<PRE>Generated by cloudfront (CloudFront)
Request ID: 7Kx9mQ-example-Ab12</PRE></BODY></HTML>`;

describe('blockPageReason — riconosce che quello che abbiamo in mano non è il sito', () => {
    it('riconosce CloudFront', () => {
        expect(blockPageReason(CLOUDFRONT_BLOCK)).toBe('cloudfront');
    });

    it('riconosce Cloudflare, sia il blocco sia la sfida javascript', () => {
        expect(blockPageReason('<html><head><title>Attention Required! | Cloudflare</title></head><body>Sorry, you have been blocked</body></html>')).toBe('cloudflare');
        expect(blockPageReason('<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>')).toBe('cloudflare');
    });

    it('riconosce Akamai e le pagine di errore nude', () => {
        expect(blockPageReason('<html><body><h1>Access Denied</h1><p>You don\'t have permission to access "http://x/" on this server.</p><p>Reference #18.abc</p></body></html>')).toBe('akamai');
        expect(blockPageReason('<html><head><title>403 Forbidden</title></head><body><h1>403 Forbidden</h1><hr>nginx</body></html>')).toBe('http-error');
    });

    // Il discriminante che tiene bassi i falsi positivi: una pagina di blocco è CORTA. Una
    // homepage vera che nomina "access denied" nel suo testo non lo è.
    it('non accusa una pagina lunga solo perché contiene certe parole', () => {
        const realSite = `<html><head><title>Manuale di sicurezza</title></head><body>
            <h1>Access Denied: come si progetta un errore 403</h1>${'contenuto vero '.repeat(400)}</body></html>`;
        expect(blockPageReason(realSite)).toBeNull();
    });

    it('lascia passare un sito normale', () => {
        expect(blockPageReason(`<html><body>${'parola '.repeat(200)}</body></html>`)).toBeNull();
    });
});

// ginshop.it: il dominio rimanda a ilgin.it, ma il suo certificato HTTPS non lo copre. Il wizard
// forza https://, sbatte sul certificato e dichiara il sito irraggiungibile — mentre esiste.
describe('resolveEntryUrl — un certificato rotto non è un sito che non esiste', () => {
    const probe = (byUrl: Record<string, { tlsError?: boolean; finalUrl?: string | null }>): EntryProbe =>
        vi.fn(async (u: string) => ({
            tlsError: byUrl[u]?.tlsError ?? false,
            finalUrl: byUrl[u]?.finalUrl ?? null
        }));

    it('segue il redirect via http quando https fallisce sul certificato', async () => {
        const p = probe({
            'https://ginshop.it': { tlsError: true },
            'http://ginshop.it': { finalUrl: 'https://ilgin.it/' }
        });
        expect(await resolveEntryUrl('https://ginshop.it', p)).toBe('https://ilgin.it/');
    });

    it('non tocca un indirizzo che funziona', async () => {
        const p = probe({ 'https://example.com': { finalUrl: 'https://example.com/' } });
        expect(await resolveEntryUrl('https://example.com', p)).toBe('https://example.com');
        expect(p).toHaveBeenCalledTimes(1);
    });

    // Se il redirect NON risale a https non si prosegue in chiaro di nascosto: l'indirizzo resta
    // quello di partenza e l'analisi fallirà onestamente.
    it('non degrada in chiaro quando il redirect resta su http', async () => {
        const p = probe({
            'https://vecchio.it': { tlsError: true },
            'http://vecchio.it': { finalUrl: 'http://vecchio.it/home' }
        });
        expect(await resolveEntryUrl('https://vecchio.it', p)).toBe('https://vecchio.it');
    });

    it('non ritenta quando https fallisce per altro (404, timeout)', async () => {
        const p = probe({ 'https://example.com': { tlsError: false, finalUrl: null } });
        expect(await resolveEntryUrl('https://example.com', p)).toBe('https://example.com');
        expect(p).toHaveBeenCalledTimes(1);
    });
});

// Also the gate for reference-image URLs the chatbot picks out of a conversation — a model-supplied
// URL is fetched server-side, so it must never be able to reach the internal network.
describe('isUrlSafe', () => {
    it('allows ordinary public http(s) urls', () => {
        expect(isUrlSafe('https://kszazivzwievqixcnanp.supabase.co/storage/v1/object/public/media/a.jpg')).toBe(true);
        expect(isUrlSafe('http://example.com/photo.png')).toBe(true);
    });

    it('blocks loopback, private ranges and the cloud metadata endpoint', () => {
        for (const url of [
            'http://localhost/admin',
            'http://127.0.0.1:3000/',
            'http://10.0.0.5/',
            'http://192.168.1.1/',
            'http://172.16.0.1/',
            'http://169.254.169.254/latest/meta-data/',
            'http://[::1]/',
            'http://[fd00::1]/'
        ]) {
            expect(isUrlSafe(url), url).toBe(false);
        }
    });

    it('blocks non-http schemes and junk', () => {
        expect(isUrlSafe('file:///etc/passwd')).toBe(false);
        expect(isUrlSafe('data:image/png;base64,AAAA')).toBe(false);
        expect(isUrlSafe('not a url')).toBe(false);
    });
});
