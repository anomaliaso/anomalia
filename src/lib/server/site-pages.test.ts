import { describe, expect, it, vi } from 'vitest';
import {
  assertPublicUrlLive,
  extractSeoMetaFromArtifact,
  isAppHostedContentUrl,
  isAppHostedSitePageUrl,
  metaDescriptionFromBody,
  parseMetaTagsBlock,
  stripLeadingMarkdownH1
} from '$lib/server/site-pages';
import { isPublishVerifyEnabled } from '$lib/server/feature-flags';

describe('site page markdown/meta helpers', () => {
  it('strips a leading H1', () => {
    expect(stripLeadingMarkdownH1('# Hello\n\nBody')).toBe('Body');
    expect(stripLeadingMarkdownH1('## Keep\n\nBody')).toBe('## Keep\n\nBody');
  });

  it('parses metaTags block', () => {
    const m = parseMetaTagsBlock('Title: Acme Landing\nMeta description: Short desc here');
    expect(m.metaTitle).toBe('Acme Landing');
    expect(m.metaDescription).toBe('Short desc here');
  });

  it('extracts meta from artifact and drops metaTags from body', () => {
    const extracted = extractSeoMetaFromArtifact({
      title: 'Fallback',
      blocks: [
        { labelKey: 'landingCopy', content: '# Big H1\n\nUseful intro paragraph about the product.' },
        { labelKey: 'metaTags', content: 'Title: Real Title\nMeta description: Real desc' }
      ]
    });
    expect(extracted.metaTitle).toBe('Real Title');
    expect(extracted.metaDescription).toBe('Real desc');
    expect(extracted.bodyMd.startsWith('#')).toBe(false);
    expect(extracted.bodyMd).toContain('Useful intro');
  });

  it('builds meta description from body when missing', () => {
    expect(metaDescriptionFromBody('# T\n\nHello **world** and [x](http://y).').length).toBeGreaterThan(0);
    expect(metaDescriptionFromBody('a'.repeat(300)).length).toBe(160);
  });
});

describe('app-hosted URL shapes', () => {
  it('detects site page and article paths', () => {
    expect(isAppHostedSitePageUrl('https://www.anomalia.so/blog/acme/p/compare-x')).toBe(true);
    expect(isAppHostedSitePageUrl('https://www.anomalia.so/blog/acme/my-post')).toBe(false);
    expect(isAppHostedContentUrl('https://www.anomalia.so/blog/acme/p/compare-x')).toBe(true);
    expect(isAppHostedContentUrl('https://www.anomalia.so/blog/acme/my-post')).toBe(true);
    expect(isAppHostedContentUrl('https://custom.com/p/compare-x')).toBe(false);
  });
});

describe('assertPublicUrlLive', () => {
  it('returns ok on HTTP 200 with body', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>ok</html>', { status: 200 }));
    const res = await assertPublicUrlLive('https://example.com/p/x', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  it('fails hard on custom-domain 404', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    const res = await assertPublicUrlLive('https://custom.com/p/x', { fetchImpl: fetchImpl as unknown as typeof fetch, softDbOk: true });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it('soft-oks app-hosted 404 when softDbOk', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    const res = await assertPublicUrlLive('https://www.anomalia.so/blog/acme/p/x', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      softDbOk: true
    });
    expect(res.ok).toBe(true);
    expect(res.soft).toBe(true);
  });
});

describe('publish verify flag', () => {
  it('defaults on', () => {
    expect(isPublishVerifyEnabled()).toBe(true);
  });
});
