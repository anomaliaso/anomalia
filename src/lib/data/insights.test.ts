import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { getInsight, INSIGHTS, INSIGHT_SLUGS } from './insights';
import { MARKETING_PATHS } from '$lib/seo';

describe('insights', () => {
  it('has unique slugs and matching EN/IT section counts', () => {
    expect(new Set(INSIGHT_SLUGS).size).toBe(INSIGHTS.length);
    for (const article of INSIGHTS) {
      expect(article.sections.it).toHaveLength(article.sections.en.length);
      expect(article.relatedPaths.length).toBeGreaterThan(0);
    }
  });

  it('exposes Gemini 3.7 Flash as the latest Product insight', () => {
    const article = getInsight('gemini-3-7-flash');
    expect(article).toBeDefined();
    expect(article!.publishedAt).toBe('2026-08-14');
    expect(article!.category.en).toBe('Product');
    expect(article!.title.en).toContain('Gemini 3.7 Flash');
    expect(article!.title.it).toContain('Gemini 3.7 Flash');
    expect(INSIGHTS[0].slug).toBe('gemini-3-7-flash');
    const enImgs = article!.sections.en.map((s) => s.image?.src).filter(Boolean);
    const itImgs = article!.sections.it.map((s) => s.image?.src).filter(Boolean);
    expect(enImgs).toHaveLength(3);
    expect(itImgs).toEqual(enImgs);
    expect(article!.cover?.src).toBe('/insights/gemini-37-glance.webp');
    for (const src of enImgs) {
      expect(existsSync(`static${src}`)).toBe(true);
    }
  });

  it('links related paths that exist on the marketing site', () => {
    const known = new Set(MARKETING_PATHS);
    for (const article of INSIGHTS) {
      for (const path of article.relatedPaths) {
        expect(known.has(path) || path.startsWith('/docs/')).toBe(true);
      }
    }
  });
});
