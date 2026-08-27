import { describe, it, expect } from 'vitest';
import { scoreArticle } from './article-score';

const goodBody = `Intro paragraph that sets up the article with enough context to matter.

## First section
Some text with a statistic: 42% of users prefer this. Read [our guide](/guide) and an [external source](https://example.com/study).

![A clear chart of results](https://cdn.test/chart.png)

## Second section
More depth here, citing [another source](https://research.org/paper) for balance.

### A sub point
Closing thoughts and a wrap up.`;

describe('scoreArticle', () => {
  it('counts internal vs external links by brand host', () => {
    const r = scoreArticle({ bodyMd: goodBody }, 'mybrand.com');
    expect(r.metrics.internalLinks).toBe(1); // /guide
    expect(r.metrics.externalLinks).toBe(2); // example.com + research.org
    expect(r.metrics.images).toBe(1);
  });

  it('flags a missing alt text', () => {
    const r = scoreArticle({ bodyMd: '## H\n![](https://x/y.png)' }, null);
    expect(r.checks.find((c) => c.key === 'alt')?.verdict).toBe('fail');
  });

  it('weights sum to 100', () => {
    const r = scoreArticle({ bodyMd: 'x', metaTitle: 't', metaDescription: 'd' }, null);
    expect(r.checks.reduce((s, c) => s + c.weight, 0)).toBe(100);
  });
});

describe('coverage gating', () => {
  it('marks alt as NOT APPLICABLE on an article with no images, instead of failing it', () => {
    const noImages = goodBody.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    const r = scoreArticle({ bodyMd: noImages }, 'mybrand.com');
    expect(r.checks.find((c) => c.key === 'alt')?.verdict).toBe('na');

    // The old scorer charged this article 10 points for alt text it could not possibly have. An
    // image with an empty alt — a real failure — must still score strictly worse.
    const realFailure = scoreArticle({ bodyMd: `${noImages}\n\n![](https://cdn.test/x.png)` }, 'mybrand.com');
    expect(realFailure.checks.find((c) => c.key === 'alt')?.verdict).toBe('fail');
    expect(r.score!).toBeGreaterThan(realFailure.score!);
  });

  it('treats plagiarism and JSON-LD as UNKNOWN when nobody checked them', () => {
    const r = scoreArticle({ bodyMd: goodBody }, 'mybrand.com');
    expect(r.checks.find((c) => c.key === 'plagiarism')?.verdict).toBe('unknown');
    expect(r.checks.find((c) => c.key === 'jsonld')?.verdict).toBe('unknown');
    expect(r.unknown).toContain('Schema JSON-LD');
    expect(r.coverage).toBeLessThan(100);
  });

  it('sits an unknown strictly between a fail and a pass, and shows the thinner evidence', () => {
    const unknown = scoreArticle({ bodyMd: goodBody }, 'mybrand.com');
    const asPass = scoreArticle({ bodyMd: goodBody, hasJsonLd: true, plagiarismClean: true }, 'mybrand.com');
    const asFail = scoreArticle({ bodyMd: goodBody, hasJsonLd: false, plagiarismClean: false }, 'mybrand.com');

    // The old code hardcoded these to `true`, handing every article 11 free points.
    expect(unknown.score!).toBeLessThan(asPass.score!);
    expect(unknown.score!).toBeGreaterThan(asFail.score!);
    // And the missing evidence is visible instead of silently filled — the whole point.
    expect(unknown.coverage).toBeLessThan(100);
    expect(asPass.coverage).toBe(100);
  });

  it('takes the answer when the caller supplies it', () => {
    const clean = scoreArticle({ bodyMd: goodBody, hasJsonLd: true }, 'mybrand.com');
    const missing = scoreArticle({ bodyMd: goodBody, hasJsonLd: false }, 'mybrand.com');
    expect(clean.checks.find((c) => c.key === 'jsonld')?.verdict).toBe('pass');
    expect(missing.checks.find((c) => c.key === 'jsonld')?.verdict).toBe('fail');
    expect(clean.score!).toBeGreaterThan(missing.score!);
  });

  it('reports the score over its denominator and a band', () => {
    const r = scoreArticle({ bodyMd: goodBody, metaTitle: 'A tight SEO title', metaDescription: 'A'.repeat(120) }, 'mybrand.com');
    expect(r.label).toContain('/100');
    expect(r.label).toContain('%');
    expect(r.band).not.toBeNull();
    expect(r.tier).toBe('full');
  });
});
