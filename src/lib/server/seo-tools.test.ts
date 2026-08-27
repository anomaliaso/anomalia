import { describe, it, expect } from 'vitest';
import { analyseMetaTags, analyseSchema, parseRobots, isPathAllowed, analyseRobots, analyseContent, extractLinks } from './seo-tools';

describe('analyseMetaTags', () => {
  const html = `<!doctype html><html lang="it"><head>
    <title>Un titolo perfettamente ragionevole per una pagina</title>
    <meta name="description" content="Una descrizione abbastanza lunga da superare la soglia minima di settanta caratteri richiesta." />
    <link rel="canonical" href="https://example.com/x" />
    <meta name="viewport" content="width=device-width" />
    <meta property="og:title" content="OG &amp; title" />
    <meta property="og:image" content="https://example.com/i.png" />
    <meta name="twitter:card" content="summary" />
  </head><body></body></html>`;

  it('reads head metadata and decodes entities', () => {
    const r = analyseMetaTags(html, 'https://example.com/x');
    expect(r.title).toBe('Un titolo perfettamente ragionevole per una pagina');
    expect(r.lang).toBe('it');
    expect(r.canonical).toBe('https://example.com/x');
    expect(r.og.title).toBe('OG & title');
    expect(r.twitter.card).toBe('summary');
    expect(r.issues).toEqual([]);
  });

  it('flags noindex as high severity and a missing title', () => {
    const r = analyseMetaTags('<html><head><meta name="robots" content="noindex, follow"></head></html>', 'https://e.com');
    expect(r.issues.find((i) => i.title === 'Page is set to noindex')?.severity).toBe('high');
    expect(r.issues.some((i) => i.title === 'Missing title')).toBe(true);
  });
});

describe('analyseSchema', () => {
  it('collects nested @type values from valid JSON-LD', () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Organization","name":"X",
       "makesOffer":{"@type":"Offer","itemOffered":{"@type":"Service"}}}
    </script>`;
    const r = analyseSchema(html, 'https://e.com');
    expect(r.blocks).toHaveLength(1);
    expect(r.types.sort()).toEqual(['Offer', 'Organization', 'Service']);
  });

  it('reports malformed JSON-LD as high severity rather than silently skipping it', () => {
    const r = analyseSchema('<script type="application/ld+json">{"@type": broken}</script>', 'https://e.com');
    expect(r.blocks[0].valid).toBe(false);
    expect(r.issues[0].severity).toBe('high');
  });
});

describe('robots.txt', () => {
  const raw = `
# comment
User-agent: *
Disallow: /admin
Allow: /admin/public

User-agent: GPTBot
User-agent: CCBot
Disallow: /

Sitemap: https://example.com/sitemap.xml
`;

  it('shares a rule block across consecutive user-agent lines', () => {
    const { groups, sitemaps } = parseRobots(raw);
    expect(sitemaps).toEqual(['https://example.com/sitemap.xml']);
    const gpt = groups.find((g) => g.userAgent === 'GPTBot');
    const ccbot = groups.find((g) => g.userAgent === 'CCBot');
    expect(gpt?.disallow).toEqual(['/']);
    expect(ccbot?.disallow).toEqual(['/']);
  });

  it('resolves longest-match with Allow winning ties', () => {
    const { groups } = parseRobots(raw);
    expect(isPathAllowed(groups, '*', '/admin/secret').allowed).toBe(false);
    // Longer Allow pattern beats the shorter Disallow.
    expect(isPathAllowed(groups, '*', '/admin/public/page').allowed).toBe(true);
    expect(isPathAllowed(groups, '*', '/blog').allowed).toBe(true);
  });

  it('gives an exact agent block precedence over the wildcard block', () => {
    const { groups } = parseRobots(raw);
    // GPTBot is blocked everywhere even though '*' allows /blog.
    expect(isPathAllowed(groups, 'GPTBot', '/blog').allowed).toBe(false);
  });

  it('supports the $ end-anchor and * wildcard', () => {
    const { groups } = parseRobots('User-agent: *\nDisallow: /*.pdf$');
    expect(isPathAllowed(groups, '*', '/files/a.pdf').allowed).toBe(false);
    expect(isPathAllowed(groups, '*', '/files/a.pdf?x=1').allowed).toBe(true);
  });

  it('surfaces blocked AI crawlers as an issue', () => {
    const r = analyseRobots(raw, 'https://example.com', '/blog', true);
    const ai = r.issues.find((i) => i.title.includes('AI crawler'));
    expect(ai?.detail).toContain('GPTBot');
    expect(ai?.detail).toContain('CCBot');
  });
});

describe('analyseContent', () => {
  const html = `<html><body>
    <h1>One</h1><h2>Two</h2><h4>Skipped</h4>
    <img src="/a.png"><img src="/b.png" alt="ok"><img src="/c.png" alt="">
    <a href="/internal">i</a><a href="https://other.com/x" rel="nofollow">e</a>
  </body></html>`;

  it('counts images, links and heading structure', () => {
    const r = analyseContent(html, 'https://example.com/page');
    expect(r.images).toMatchObject({ total: 3, missingAlt: 1, emptyAlt: 1 });
    expect(r.links).toMatchObject({ internal: 1, external: 1, nofollow: 1 });
    expect(r.headings.map((h) => h.level)).toEqual([1, 2, 4]);
    expect(r.issues.some((i) => i.title === 'Heading levels skip')).toBe(true);
  });

  it('resolves relative hrefs against the page URL', () => {
    expect(extractLinks('<a href="/x">a</a><a href="#frag">b</a>', 'https://e.com/dir/')).toEqual(['https://e.com/x']);
  });
});
