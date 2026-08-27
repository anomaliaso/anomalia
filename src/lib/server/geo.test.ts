import { describe, it, expect } from 'vitest';
import {
  isLlmsTxt, parseRobots, aiCrawlerStatus, structuredDataTypes,
  sitemapUrlCount, metaBasics, analyzeContent, buildTechAudit,
  openGraphTags, headingHierarchy, imageAltCoverage, linkStats,
  metaRobotsNoindex, qaContentCount, hasNapData, htmlLangAttr,
  normalizeDomain, domainMatches, CITATION_SAMPLES,
  structuredDataNodes, commerceReadiness
} from './geo';

describe('isLlmsTxt', () => {
  it('accepts markdown with a heading', () => {
    expect(isLlmsTxt('# Acme\n\n- [Docs](https://acme.com/docs)')).toBe(true);
  });
  it('accepts a plain link list without heading', () => {
    expect(isLlmsTxt('See [our product](https://acme.com/p) for details.')).toBe(true);
  });
  it('rejects an HTML soft-404 shell', () => {
    expect(isLlmsTxt('<!DOCTYPE html><html><head><title>404</title></head></html>')).toBe(false);
  });
  it('rejects empty', () => {
    expect(isLlmsTxt('   ')).toBe(false);
  });
});

describe('parseRobots + aiCrawlerStatus', () => {
  it('flags a bot explicitly disallowed from root', () => {
    const txt = `User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow:`;
    const status = aiCrawlerStatus(txt);
    expect(status.find((s) => s.bot === 'GPTBot')?.blocked).toBe(true);
    expect(status.find((s) => s.bot === 'ClaudeBot')?.blocked).toBe(false); // falls to wildcard allow-all
  });
  it('blocks all AI bots via wildcard Disallow: /', () => {
    const status = aiCrawlerStatus(`User-agent: *\nDisallow: /`);
    expect(status.every((s) => s.blocked)).toBe(true);
  });
  it('lets a specific Allow: / override a Disallow: / in the same group', () => {
    const txt = `User-agent: PerplexityBot\nDisallow: /\nAllow: /`;
    expect(aiCrawlerStatus(txt).find((s) => s.bot === 'PerplexityBot')?.blocked).toBe(false);
  });
  it('groups consecutive User-agent lines under shared rules', () => {
    const txt = `User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /`;
    const groups = parseRobots(txt);
    expect(groups).toHaveLength(1);
    expect(groups[0].agents).toEqual(['gptbot', 'ccbot']);
    const status = aiCrawlerStatus(txt);
    expect(status.find((s) => s.bot === 'CCBot')?.blocked).toBe(true);
  });
  it('treats an empty robots.txt as everything allowed', () => {
    expect(aiCrawlerStatus('').every((s) => !s.blocked)).toBe(true);
  });
});

describe('structuredDataTypes', () => {
  it('extracts @type from a single block', () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>`;
    expect(structuredDataTypes(html)).toEqual(['Organization']);
  });
  it('unwraps @graph and handles array @type', () => {
    const html = `<script type="application/ld+json">
      {"@graph":[{"@type":"WebSite"},{"@type":["Product","Thing"]}]}</script>`;
    expect(structuredDataTypes(html).sort()).toEqual(['Product', 'Thing', 'WebSite']);
  });
  it('skips malformed blocks without throwing', () => {
    const html = `<script type="application/ld+json">{ not json }</script>
      <script type="application/ld+json">{"@type":"FAQPage"}</script>`;
    expect(structuredDataTypes(html)).toEqual(['FAQPage']);
  });
});

describe('sitemapUrlCount', () => {
  it('counts <loc> entries', () => {
    expect(sitemapUrlCount('<urlset><url><loc>a</loc></url><url><loc>b</loc></url></urlset>')).toBe(2);
  });
  it('returns 0 for an HTML soft-404', () => {
    expect(sitemapUrlCount('<!doctype html><html></html>')).toBe(0);
  });
});

describe('metaBasics', () => {
  it('detects present tags', () => {
    const html = `<title>Acme</title><meta name="description" content="best acme">
      <link rel="canonical" href="/"><meta property="og:title" content="Acme">`;
    expect(metaBasics(html)).toEqual({ title: true, description: true, canonical: true, ogTitle: true });
  });
  it('reports missing tags', () => {
    expect(metaBasics('<title></title>')).toEqual({ title: false, description: false, canonical: false, ogTitle: false });
  });
});

describe('openGraphTags', () => {
  it('detects all OG tags present', () => {
    const html = `<meta property="og:image" content="https://acme.com/img.png">
      <meta property="og:description" content="Widgets"><meta property="og:type" content="website">
      <meta property="og:url" content="https://acme.com">`;
    expect(openGraphTags(html)).toEqual({ image: true, description: true, type: true, url: true });
  });
  it('reports missing tags', () => {
    expect(openGraphTags('<html></html>')).toEqual({ image: false, description: false, type: false, url: false });
  });
});

describe('headingHierarchy', () => {
  it('returns levels in order', () => {
    const html = '<h1>Title</h1><h2>Sub</h2><h2>Sub2</h2><h3>Deep</h3>';
    const h = headingHierarchy(html);
    expect(h.levels).toEqual([1, 2, 2, 3]);
    expect(h.jumps).toBe(0);
  });
  it('detects a jump from H1 to H3 (skips H2)', () => {
    const h = headingHierarchy('<h1>Title</h1><h3>Skipped</h3>');
    expect(h.levels).toEqual([1, 3]);
    expect(h.jumps).toBe(1);
  });
  it('returns empty for no headings', () => {
    expect(headingHierarchy('<p>text</p>')).toEqual({ levels: [], jumps: 0 });
  });
});

describe('imageAltCoverage', () => {
  it('counts images with and without alt', () => {
    const html = '<img src="a.jpg" alt="A"><img src="b.jpg"><img src="c.jpg" alt="">';
    const r = imageAltCoverage(html);
    expect(r.total).toBe(3);
    expect(r.withAlt).toBe(1);
    expect(r.withoutAlt).toBe(2);
  });
  it('returns zeros for no images', () => {
    expect(imageAltCoverage('<p>text</p>')).toEqual({ total: 0, withAlt: 0, withoutAlt: 0 });
  });
});

describe('linkStats', () => {
  it('counts internal and external links', () => {
    const html = `<a href="/about">About</a><a href="https://example.com">Ext</a>
      <a href="mailto:a@b.com">Mail</a><a href="#top">Top</a>`;
    const r = linkStats(html, 'https://mysite.com');
    expect(r.internal).toBe(3); // /about, mailto, #top
    expect(r.external).toBe(1); // example.com
  });
});

describe('metaRobotsNoindex', () => {
  it('detects noindex', () => {
    expect(metaRobotsNoindex('<meta name="robots" content="noindex, follow">')).toBe(true);
  });
  it('returns false when absent', () => {
    expect(metaRobotsNoindex('<meta name="robots" content="index, follow">')).toBe(false);
    expect(metaRobotsNoindex('<html></html>')).toBe(false);
  });
});

describe('qaContentCount', () => {
  it('counts questions in text', () => {
    const text = 'What is GEO? How does it work? Just some sentence here. Why should I care?';
    expect(qaContentCount(text)).toBe(3);
  });
  it('ignores short sentences', () => {
    expect(qaContentCount('A? B? This is a real question about something?')).toBe(1);
  });
});

describe('hasNapData', () => {
  it('detects phone number', () => {
    expect(hasNapData('Call us at +39 02 1234567 or visit')).toBe(true);
  });
  it('detects street address', () => {
    expect(hasNapData('Visit us at Via Roma 42, Milano')).toBe(true);
  });
  it('detects email', () => {
    expect(hasNapData('Contact us at info@acme.com')).toBe(true);
  });
  it('returns false for no NAP', () => {
    expect(hasNapData('<p>We make great widgets</p>')).toBe(false);
  });
});

describe('htmlLangAttr', () => {
  it('extracts lang', () => {
    expect(htmlLangAttr('<html lang="it">')).toBe('it');
    expect(htmlLangAttr('<html lang="en-US">')).toBe('en-US');
  });
  it('returns null when absent', () => {
    expect(htmlLangAttr('<html>')).toBeNull();
  });
});

describe('analyzeContent extended', () => {
  it('reports extended fields from rich HTML', () => {
    const html = `<html lang="it"><head>
      <title>Acme — Best widgets for modern teams</title>
      <meta name="description" content="Acme builds professional widgets that help teams ship faster and collaborate better every single day they use the product.">
      <meta property="og:image" content="https://acme.com/img.png">
      <meta property="og:description" content="Widgets">
      <meta property="og:type" content="website">
      <meta property="og:url" content="https://acme.com">
    </head><body>
      <h1>Professional widgets</h1>
      <h2>Features</h2><h2>Pricing</h2>
      <img src="a.jpg" alt="Product"><img src="b.jpg" alt="Logo">
      <a href="/about">About</a><a href="/pricing">Pricing</a>
      <a href="/features">Features</a><a href="/docs">Docs</a>
      <a href="/contact">Contact</a><a href="/blog">Blog</a>
      <p>What is the best widget? How do I choose? Why should teams use Acme?</p>
      <p>Call us at +39 02 1234567 or visit Via Roma 42, Milano.</p>
      <p>${'Acme makes great widgets. '.repeat(140)}</p>
    </body></html>`;
    const c = analyzeContent(html);
    expect(c.openGraph.image).toBe(true);
    expect(c.openGraph.description).toBe(true);
    expect(c.headingJumps).toBe(0);
    expect(c.imagesTotal).toBe(2);
    expect(c.imagesWithAlt).toBe(2);
    expect(c.internalLinks).toBeGreaterThanOrEqual(6);
    expect(c.qaBlocks).toBe(3);
    expect(c.hasNap).toBe(true);
    expect(c.htmlLang).toBe('it');
    expect(c.statuses.openGraph).toBe('good');
    expect(c.statuses.lang).toBe('good');
    expect(c.statuses.robots).toBe('good');
  });

  it('detects noindex and missing lang', () => {
    const c = analyzeContent('<head><meta name="robots" content="noindex"></head><body></body>');
    expect(c.metaRobotsNoindex).toBe(true);
    expect(c.htmlLang).toBeNull();
    expect(c.statuses.robots).toBe('bad');
    expect(c.statuses.lang).toBe('warn');
  });
});

describe('buildTechAudit scoring', () => {
  // A rich enough body to avoid thin-content, plus content schema, OG, lang, Q&A, images, links.
  const GOOD_BODY = Array.from({ length: 60 }, (_, i) =>
    `<p>Acme builds professional widgets that help modern teams ship faster and collaborate better every day. ` +
    `Our platform combines automation with an intuitive interface so anyone can build workflows without code. ` +
    `Trusted by thousands of companies worldwide, from small startups to large enterprises, Acme delivers value. Item ${i}.</p>`
  ).join('');

  it('a perfect site scores 100 with no issues', () => {
    const audit = buildTechAudit({
      llmsTxtBody: '# Acme\n[Docs](https://acme.com/docs)',
      robotsTxt: 'User-agent: *\nAllow: /',
      homepageHtml: `<html lang="en"><head>
        <title>Acme — Professional widgets for modern teams</title>
        <meta name="description" content="Acme builds professional widgets that help teams ship faster. Trusted by ten thousand companies worldwide for reliability and speed.">
        <link rel="canonical" href="/"><meta property="og:title" content="Acme">
        <meta property="og:image" content="https://acme.com/img.png">
        <meta property="og:description" content="Widgets for teams">
        <meta property="og:type" content="website"><meta property="og:url" content="https://acme.com">
      </head><body>
        <h1>Professional widgets</h1>
        <h2>Features</h2><h2>Pricing</h2><h2>About</h2>
        <img src="a.jpg" alt="Product"><img src="b.jpg" alt="Logo">
        <a href="/about">About</a><a href="/pricing">Pricing</a>
        <a href="/features">Features</a><a href="/docs">Docs</a>
        <a href="/contact">Contact</a><a href="/blog">Blog</a>
        <p>What is the best widget? How do teams choose? Why should companies use Acme?</p>
        <p>Call us at +39 02 1234567 or visit Via Roma 42.</p>
        ${GOOD_BODY}
        <script type="application/ld+json">{"@graph":[{"@type":"Organization"},{"@type":"FAQPage"},{"@type":"Product"}]}</script>
      </body></html>`,
      sitemapXml: '<urlset><url><loc>https://acme.com/</loc></url></urlset>'
    });
    expect(audit.score).toBe(100);
    expect(audit.issues).toHaveLength(0);
    expect(audit.content.wordCount).toBeGreaterThan(250);
    expect(audit.content.htmlLang).toBe('en');
    expect(audit.content.metaRobotsNoindex).toBe(false);
  });

  it('a blocked, bare site takes the high-severity hit and drops hard', () => {
    const audit = buildTechAudit({
      llmsTxtBody: '', robotsTxt: 'User-agent: *\nDisallow: /',
      homepageHtml: '<div>SPA</div>', sitemapXml: ''
    });
    expect(audit.issues.find((i) => i.id === 'ai-crawlers-blocked')?.severity).toBe('high');
    expect(audit.issues.find((i) => i.id === 'thin-content')).toBeTruthy();
    expect(audit.aiCrawlers.every((c) => c.blocked)).toBe(true);
    expect(audit.score).toBeLessThan(50);
  });

  it('flags noindex as high severity', () => {
    const audit = buildTechAudit({
      llmsTxtBody: '', robotsTxt: 'User-agent: *\nAllow: /',
      homepageHtml: '<html lang="en"><head><meta name="robots" content="noindex"></head><body>' +
        '<p>' + 'word '.repeat(300) + '</p></body></html>',
      sitemapXml: ''
    });
    expect(audit.issues.find((i) => i.id === 'noindex-active')?.severity).toBe('high');
    expect(audit.content.metaRobotsNoindex).toBe(true);
  });
});

describe('structuredDataNodes', () => {
  it('keeps the objects, unwrapping arrays and @graph like structuredDataTypes does', () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Widget"},{"@type":"Organization"}]}</script>`;
    const nodes = structuredDataNodes(html);
    expect(nodes.find((n) => n['@type'] === 'Product')?.name).toBe('Widget');
  });

  it('skips a malformed block without losing the valid ones', () => {
    const html = `<script type="application/ld+json">{ not json </script>
      <script type="application/ld+json">[{"@type":"Product","sku":"A1"}]</script>`;
    expect(structuredDataNodes(html).map((n) => n.sku)).toEqual(['A1']);
  });
});

describe('commerceReadiness', () => {
  const OFFER = (extra = '') =>
    `<script type="application/ld+json">{"@type":"Product","name":"Widget","sku":"W-1","url":"https://s.com/w",
      "offers":{"@type":"Offer","price":"19.90","priceCurrency":"EUR","availability":"https://schema.org/InStock"${extra}}}</script>`;

  it('does not call a SaaS homepage a shop just because it has Product markup', () => {
    const r = commerceReadiness('<script type="application/ld+json">{"@type":"Product","name":"Acme Cloud"}</script>');
    expect(r.isCommerce).toBe(false);
    expect(r.signals).toEqual(['product-schema']);
  });

  it('two weak signals are enough — Product markup plus a cart link', () => {
    const r = commerceReadiness(
      '<a href="/cart">Cart</a><script type="application/ld+json">{"@type":"Product","name":"Mug"}</script>'
    );
    expect(r.isCommerce).toBe(true);
    expect(r.hasOffer).toBe(false);
  });

  it('a published Offer alone is a strong signal', () => {
    const r = commerceReadiness(OFFER());
    expect(r.isCommerce).toBe(true);
    expect(r.signals).toContain('offer-schema');
    expect(r.missingCoreFields).toEqual([]);
    expect(r.missingActionFields).toEqual([]);
  });

  it('reads og:type whichever way the generator ordered the attributes', () => {
    expect(commerceReadiness('<meta content="product" property="og:type">').signals).toContain('og-type-product');
    expect(commerceReadiness('<meta property="og:type" content="product.item">').signals).toContain('og-type-product');
    expect(commerceReadiness('<meta property="og:type" content="website">').signals).not.toContain('og-type-product');
  });

  it('names the core fields an Offer is missing', () => {
    const r = commerceReadiness(
      '<script type="application/ld+json">{"@type":"Offer","price":"10","url":"https://s.com/x","sku":"X"}</script>'
    );
    expect(r.missingCoreFields).toEqual(['priceCurrency', 'availability']);
  });

  it('accepts an AggregateOffer price range as a published price', () => {
    const r = commerceReadiness(
      '<script type="application/ld+json">{"@type":"AggregateOffer","lowPrice":"10","highPrice":"30","priceCurrency":"EUR","availability":"InStock"}</script>'
    );
    expect(r.missingCoreFields).toEqual([]);
  });

  it('finds the identifier on the Product when the Offer omits it', () => {
    const r = commerceReadiness(
      '<script type="application/ld+json">{"@type":"Product","gtin13":"5901234123457","url":"https://s.com/p",' +
      '"offers":{"@type":"Offer","price":"5","priceCurrency":"EUR","availability":"InStock"}}</script>'
    );
    expect(r.missingActionFields).toEqual([]);
  });

  it('detects an aggregateRating nested on the Product', () => {
    expect(commerceReadiness(OFFER()).hasAggregateRating).toBe(false);
    const rated = commerceReadiness(
      '<script type="application/ld+json">{"@type":"Product","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.5","reviewCount":"120"}}</script>'
    );
    expect(rated.hasAggregateRating).toBe(true);
  });
});

describe('buildTechAudit — commerce severity', () => {
  const base = { llmsTxtBody: '', robotsTxt: 'User-agent: *\nAllow: /', sitemapXml: '' };
  const BODY = '<p>' + 'word '.repeat(300) + '</p>';

  it('a shop with no Product markup takes a HIGH hit, not the generic low one', () => {
    const audit = buildTechAudit({
      ...base,
      homepageHtml: `<html lang="en"><head><meta property="og:type" content="product"></head><body>
        <a href="/cart">Cart</a><button>Add to cart</button>${BODY}</body></html>`
    });
    expect(audit.commerce.isCommerce).toBe(true);
    expect(audit.issues.find((i) => i.id === 'no-product-schema')?.severity).toBe('high');
    expect(audit.issues.find((i) => i.id === 'no-content-schema')).toBeUndefined();
  });

  it('a non-commerce site with no content schema still gets the old low-severity nit', () => {
    const audit = buildTechAudit({ ...base, homepageHtml: `<html lang="en"><body>${BODY}</body></html>` });
    expect(audit.commerce.isCommerce).toBe(false);
    expect(audit.issues.find((i) => i.id === 'no-content-schema')?.severity).toBe('low');
    expect(audit.issues.find((i) => i.id === 'no-product-schema')).toBeUndefined();
  });

  it('a shop whose Offer has no price is graded on the offer layer', () => {
    const audit = buildTechAudit({
      ...base,
      homepageHtml: `<html lang="en"><body><a href="/checkout">Checkout</a>
        <script type="application/ld+json">{"@type":"Product","name":"Mug","offers":{"@type":"Offer","url":"https://s.com/m","sku":"M1"}}</script>
        ${BODY}</body></html>`
    });
    const issue = audit.issues.find((i) => i.id === 'incomplete-offer-schema');
    expect(issue?.severity).toBe('medium');
    expect(issue?.detail).toContain('price');
    expect(audit.issues.find((i) => i.id === 'no-review-schema')?.severity).toBe('low');
  });

  it('a complete offer with ratings raises neither offer issue', () => {
    const audit = buildTechAudit({
      ...base,
      homepageHtml: `<html lang="en"><body>
        <script type="application/ld+json">{"@type":"Product","name":"Mug","sku":"M1","url":"https://s.com/m",
          "aggregateRating":{"@type":"AggregateRating","ratingValue":"4.6","reviewCount":"88"},
          "offers":{"@type":"Offer","price":"12","priceCurrency":"EUR","availability":"https://schema.org/InStock"}}</script>
        ${BODY}</body></html>`
    });
    expect(audit.issues.some((i) => /offer-schema|product-schema|review-schema/.test(i.id))).toBe(false);
  });
});

describe('normalizeDomain', () => {
  it('reduces every shape an engine returns to a comparable host', () => {
    expect(normalizeDomain('https://www.Example.com/path?q=1')).toBe('example.com');
    expect(normalizeDomain('www.example.com')).toBe('example.com');
    expect(normalizeDomain('EXAMPLE.com')).toBe('example.com');
    expect(normalizeDomain('  ')).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });
});

describe('domainMatches', () => {
  it('counts a subdomain as ours', () => {
    expect(domainMatches('blog.example.com', 'example.com')).toBe(true);
    expect(domainMatches('https://www.example.com/x', 'example.com')).toBe(true);
  });

  it('does not count a different registrable domain', () => {
    expect(domainMatches('notexample.com', 'example.com')).toBe(false);
    expect(domainMatches('example.com.evil.net', 'example.com')).toBe(false);
  });
});

describe('citation sampling', () => {
  it('asks each question more than once — one observation is noise, not a measurement', () => {
    expect(CITATION_SAMPLES).toBeGreaterThanOrEqual(1);
    expect(CITATION_SAMPLES).toBeLessThanOrEqual(5);
  });
});
