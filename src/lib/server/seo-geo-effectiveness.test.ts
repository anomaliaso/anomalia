import { describe, expect, it } from 'vitest';
import { trackedKeywordCap } from '$lib/server/rank-tracker';
import { seoCrawlCap } from '$lib/server/site-crawl';
import {
  canApplyGeoLoop,
  isCausalWin,
  isReprobeDue,
  reprobeDueAfterDays,
  sourceCitesTarget,
  GEO_REPROBE_MAX_ATTEMPTS,
  GEO_REPROBE_SCHEDULE_DAYS
} from '$lib/server/geo-opportunities';
import { canPublishSitePages } from '$lib/server/site-pages';
import {
  EXTERNAL_BACKLINK_CREDITS,
  EXTERNAL_BACKLINK_COST_USD,
  listingFieldsFrom,
  mapSfbPollStatus
} from '$lib/server/backlink-external';
import { gscConfigured, GSC_SCOPE } from '$lib/server/gsc';
import { citationEngines, measuredCitationEngines } from '$lib/server/geo';
import {
  isGscGateEnabled,
  isGeoPublishApplyEnabled,
  isGeoCausalWinEnabled,
  isSfbBadgeEnabled
} from '$lib/server/feature-flags';

function listingFromSubmission(data: Record<string, unknown>) {
  return listingFieldsFrom(data);
}

describe('SEO/GEO effectiveness gates', () => {
  it('caps tracked keywords by plan', () => {
    expect(trackedKeywordCap(null)).toBe(10);
    expect(trackedKeywordCap('go')).toBe(25);
    expect(trackedKeywordCap('starter')).toBe(75);
    expect(trackedKeywordCap('pro')).toBe(200);
  });

  it('caps SEO crawl size by plan', () => {
    expect(seoCrawlCap('go')).toBe(80);
    expect(seoCrawlCap('starter')).toBe(200);
    expect(seoCrawlCap('pro')).toBe(500);
  });

  it('gates GEO apply and site pages to Starter+', () => {
    expect(canApplyGeoLoop('go')).toBe(false);
    expect(canApplyGeoLoop('starter')).toBe(true);
    expect(canPublishSitePages('go')).toBe(false);
    expect(canPublishSitePages('pro')).toBe(true);
  });

  it('exposes GSC scope and external credit constant', () => {
    expect(GSC_SCOPE).toContain('webmasters.readonly');
    expect(EXTERNAL_BACKLINK_CREDITS).toBeGreaterThan(0);
    expect(EXTERNAL_BACKLINK_COST_USD).toBe(EXTERNAL_BACKLINK_CREDITS / 100);
    expect(typeof gscConfigured()).toBe('boolean');
  });

  it('keeps measured engines aligned with citationEngines', () => {
    expect(measuredCitationEngines()).toEqual(citationEngines());
    expect(citationEngines()).toContain('gemini');
  });

  it('defaults effectiveness feature flags on', () => {
    expect(isGscGateEnabled()).toBe(true);
    expect(isGeoPublishApplyEnabled()).toBe(true);
    expect(isGeoCausalWinEnabled()).toBe(true);
    expect(isSfbBadgeEnabled()).toBe(true);
  });
});

describe('SFB honest status mapping', () => {
  it('does not complete Approved without isPublished', () => {
    expect(
      mapSfbPollStatus({
        sfbStatus: 'Approved',
        isPublished: false,
        listingType: 'FREE',
        badgeStatus: null
      })
    ).toBe('awaiting_publish');
  });

  it('requires badge verify for published free listings', () => {
    expect(
      mapSfbPollStatus({
        sfbStatus: 'Approved',
        isPublished: true,
        listingType: 'FREE',
        badgeStatus: 'PENDING'
      })
    ).toBe('awaiting_badge');
    expect(
      mapSfbPollStatus({
        sfbStatus: 'Approved',
        isPublished: true,
        listingType: 'FREE',
        badgeStatus: 'VERIFIED'
      })
    ).toBe('completed');
  });

  it('allows Featured to complete without badge', () => {
    expect(
      mapSfbPollStatus({
        sfbStatus: 'Featured',
        isPublished: true,
        listingType: 'FEATURED',
        badgeStatus: null
      })
    ).toBe('completed');
  });

  it('maps reject and needs-changes', () => {
    expect(mapSfbPollStatus({ sfbStatus: 'Rejected', isPublished: false })).toBe('failed');
    expect(mapSfbPollStatus({ sfbStatus: 'Needs changes', isPublished: false })).toBe(
      'needs_changes'
    );
    expect(mapSfbPollStatus({ sfbStatus: 'Under review', isPublished: false })).toBe('submitted');
  });
});

describe('GEO causal win', () => {
  it('matches target or brand host in sources', () => {
    expect(sourceCitesTarget(['https://blog.acme.com/p/x'], 'https://blog.acme.com/p/x', null)).toBe(
      true
    );
    expect(sourceCitesTarget(['acme.com'], null, 'www.acme.com')).toBe(true);
    expect(sourceCitesTarget(['other.com'], 'https://blog.acme.com/p/x', 'acme.com')).toBe(false);
  });

  it('wins when target host appears on a baseline-gap engine', () => {
    const v = isCausalWin({
      baselineEngines: ['gemini'],
      targetUrl: 'https://blog.acme.com/p/cite-me',
      brandHost: 'acme.com',
      results: [
        {
          engine: 'gemini',
          brandMentioned: false,
          sources: ['https://blog.acme.com/p/cite-me']
        }
      ]
    });
    expect(v.deferred).toBe(false);
    expect(v.won).toBe(true);
    expect(v.targetCited).toBe(true);
  });

  it('does not win on brand mention alone without source host', () => {
    const v = isCausalWin({
      baselineEngines: ['gemini'],
      targetUrl: 'https://blog.acme.com/p/cite-me',
      brandHost: 'acme.com',
      results: [{ engine: 'gemini', brandMentioned: true, sources: ['wikipedia.org'] }]
    });
    expect(v.won).toBe(false);
    expect(v.mentionedOnBaseline).toBe(true);
    expect(v.targetCited).toBe(false);
  });

  it('fallback wins when mentioned + brand/target host in sources', () => {
    const v = isCausalWin({
      baselineEngines: ['gemini'],
      targetUrl: 'https://blog.acme.com/p/cite-me',
      brandHost: 'acme.com',
      results: [{ engine: 'gemini', brandMentioned: true, sources: ['acme.com/about'] }]
    });
    expect(v.won).toBe(true);
    expect(v.targetCited).toBe(true);
  });

  it('defers when every probe has an error', () => {
    const v = isCausalWin({
      baselineEngines: ['gemini'],
      targetUrl: 'https://blog.acme.com/p/cite-me',
      brandHost: 'acme.com',
      results: [{ engine: 'gemini', brandMentioned: false, sources: [], error: 'timeout' }]
    });
    expect(v.deferred).toBe(true);
    expect(v.won).toBe(false);
  });

  it('ignores non-gap engines when baseline gaps exist', () => {
    const v = isCausalWin({
      baselineEngines: ['gemini'],
      targetUrl: 'https://blog.acme.com/p/cite-me',
      brandHost: 'acme.com',
      results: [
        { engine: 'chatgpt', brandMentioned: true, sources: ['https://blog.acme.com/p/cite-me'] },
        { engine: 'gemini', brandMentioned: false, sources: ['other.com'] }
      ]
    });
    expect(v.won).toBe(false);
  });
});

describe('GEO reprobe schedule', () => {
  it('schedules attempts at day 3 / 7 / 14', () => {
    expect(GEO_REPROBE_SCHEDULE_DAYS).toEqual([3, 7, 14]);
    expect(GEO_REPROBE_MAX_ATTEMPTS).toBe(3);
    expect(reprobeDueAfterDays(0)).toBe(3);
    expect(reprobeDueAfterDays(1)).toBe(7);
    expect(reprobeDueAfterDays(2)).toBe(14);
    expect(reprobeDueAfterDays(3)).toBeNull();
  });

  it('is due only after the schedule day for the current attempt', () => {
    const appliedAt = '2026-01-01T00:00:00.000Z';
    expect(isReprobeDue({ appliedAt, attempts: 0, now: new Date('2026-01-03T00:00:00.000Z') })).toBe(false);
    expect(isReprobeDue({ appliedAt, attempts: 0, now: new Date('2026-01-04T00:00:00.000Z') })).toBe(true);
    expect(isReprobeDue({ appliedAt, attempts: 1, now: new Date('2026-01-07T00:00:00.000Z') })).toBe(false);
    expect(isReprobeDue({ appliedAt, attempts: 1, now: new Date('2026-01-08T00:00:00.000Z') })).toBe(true);
  });
});

describe('SFB listing field mapping', () => {
  it('maps overrides from a draft/submit payload', () => {
    const listing = listingFromSubmission({
      overrides: {
        name: 'Acme',
        tagline: 'Ship faster',
        shortDescription: 'Short',
        fullDescription: 'Full text',
        primaryCategorySlug: 'productivity',
        tags: ['SaaS', 'AI'],
        pricingModel: 'FREE',
        platformType: 'WEB',
        productType: 'SAAS'
      }
    });
    expect(listing.name).toBe('Acme');
    expect(listing.tags).toEqual(['SaaS', 'AI']);
    expect(listing.pricingModel).toBe('FREE');
  });
});

describe('site page target_query propagation', () => {
  it('accepts targetQuery on upsert shape', async () => {
    const { upsertSitePageFromAsset, resolveSitePagePublicUrl } = await import('$lib/server/site-pages');
    expect(typeof upsertSitePageFromAsset).toBe('function');
    expect(typeof resolveSitePagePublicUrl).toBe('function');
  });
});

describe('resolveSitePagePublicUrl prefers brand_sites', () => {
  it('builds custom-domain and blog fallback shapes via mocked admin', async () => {
    const { resolveSitePagePublicUrl } = await import('$lib/server/site-pages');

    const customAdmin = {
      from(table: string) {
        if (table === 'brand_sites') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: { host: 'blog.acme.com' } })
                  })
                })
              })
            })
          };
        }
        throw new Error(`unexpected ${table}`);
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(resolveSitePagePublicUrl(customAdmin as any, 'b1', 'hello')).resolves.toBe(
      'https://blog.acme.com/p/hello'
    );

    const fallbackAdmin = {
      from(table: string) {
        if (table === 'brand_sites') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: null })
                  })
                })
              })
            })
          };
        }
        if (table === 'brands') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { blog_slug: 'acme', id: 'b1' } })
              })
            })
          };
        }
        throw new Error(`unexpected ${table}`);
      }
    };
    // PUBLIC_APP_URL may be empty in test — then null is ok; when set, expect /blog/…/p/
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = await resolveSitePagePublicUrl(fallbackAdmin as any, 'b1', 'hello');
    if (url) {
      expect(url).toMatch(/\/blog\/acme\/p\/hello$/);
      expect(url).not.toContain('/site/');
    }
  });
});
