import { describe, expect, it } from 'vitest';
import {
  gscReadyFromSummary,
  formatGscPromptBlock,
  normalizeSearchQuery,
  ownedQueryCoverage,
  gscOAuthRedirectUri,
  GSC_OAUTH_CALLBACK_PATH,
  parseGscSiteList,
  gscSiteMatchesWebsite,
  rankGscSites,
  hostnameFromWebsite,
  type GscSummary
} from '$lib/server/gsc';
import { isGscInAgentEnabled, isGscGateEnabled } from '$lib/server/feature-flags';

function summary(partial: Partial<GscSummary>): GscSummary {
  return {
    connected: false,
    configured: true,
    siteUrl: null,
    syncedAt: null,
    lastError: null,
    clicks28d: 0,
    impressions28d: 0,
    topQueries: [],
    topPages: [],
    ...partial
  };
}

describe('gscReadyFromSummary', () => {
  it('is true when GSC OAuth is not configured (nothing to connect)', () => {
    expect(gscReadyFromSummary(summary({ configured: false }))).toBe(true);
  });

  it('is false when configured but not connected', () => {
    expect(gscReadyFromSummary(summary({ configured: true, connected: false }))).toBe(false);
  });

  it('is false when OAuth is connected but no property is selected', () => {
    expect(
      gscReadyFromSummary(
        summary({
          connected: true,
          siteUrl: null,
          syncedAt: new Date().toISOString(),
          clicks28d: 3
        })
      )
    ).toBe(false);
  });

  it('is false when connected without fresh sync', () => {
    expect(
      gscReadyFromSummary(
        summary({
          connected: true,
          siteUrl: 'https://example.com/',
          syncedAt: null,
          topQueries: [{ query: 'x', clicks: 1, impressions: 10, position: 3 }]
        })
      )
    ).toBe(false);
  });

  it('is false when sync is older than 7 days', () => {
    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 10);
    expect(
      gscReadyFromSummary(
        summary({
          connected: true,
          siteUrl: 'https://example.com/',
          syncedAt: old.toISOString(),
          clicks28d: 10,
          topQueries: [{ query: 'x', clicks: 1, impressions: 10, position: 3 }]
        })
      )
    ).toBe(false);
  });

  it('is true with recent sync and query data', () => {
    expect(
      gscReadyFromSummary(
        summary({
          connected: true,
          siteUrl: 'https://example.com/',
          syncedAt: new Date().toISOString(),
          clicks28d: 12,
          topQueries: [{ query: 'best crm', clicks: 5, impressions: 40, position: 4.2 }]
        })
      )
    ).toBe(true);
  });
});

describe('ownedQueryCoverage', () => {
  it('matches exact and contains', () => {
    const cov = ownedQueryCoverage(
      ['Best CRM', 'pricing page ideas', 'unrelated'],
      ['best crm', 'crm software']
    );
    expect(cov.matched).toBe(1);
    expect(cov.total).toBe(3);
    expect(cov.ratio).toBeCloseTo(1 / 3);
  });

  it('normalizes punctuation', () => {
    expect(normalizeSearchQuery('  Best-CRM!! ')).toBe('best crm');
  });
});

describe('formatGscPromptBlock', () => {
  it('is empty without queries', () => {
    expect(formatGscPromptBlock(summary({ connected: true, topQueries: [] }))).toBe('');
  });

  it('includes owned queries when present', () => {
    const block = formatGscPromptBlock(
      summary({
        connected: true,
        siteUrl: 'sc-domain:example.com',
        syncedAt: '2026-01-01T00:00:00.000Z',
        clicks28d: 9,
        impressions28d: 100,
        topQueries: [{ query: 'acme', clicks: 3, impressions: 20, position: 2 }]
      })
    );
    expect(block).toContain('OWNED SEARCH');
    expect(block).toContain('acme');
  });
});

describe('GSC feature flags', () => {
  it('default on', () => {
    expect(isGscGateEnabled()).toBe(true);
    expect(isGscInAgentEnabled()).toBe(true);
  });
});

describe('gscOAuthRedirectUri', () => {
  it('is a single fixed path independent of brand', () => {
    expect(GSC_OAUTH_CALLBACK_PATH).toBe('/auth/gsc/callback');
    expect(gscOAuthRedirectUri('https://app.example.com')).toBe(
      'https://app.example.com/auth/gsc/callback'
    );
    expect(gscOAuthRedirectUri('https://app.example.com/')).toBe(
      'https://app.example.com/auth/gsc/callback'
    );
    expect(gscOAuthRedirectUri('http://localhost:5173')).not.toContain('/app/');
  });
});

describe('parseGscSiteList', () => {
  it('reads siteEntry from the Webmasters API', () => {
    expect(
      parseGscSiteList({
        siteEntry: [
          { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
          { site_url: 'sc-domain:acme.com', permission_level: 'siteFullUser' }
        ]
      })
    ).toEqual([
      { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
      { siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteFullUser' }
    ]);
  });

  it('returns [] for missing or malformed payloads', () => {
    expect(parseGscSiteList(null)).toEqual([]);
    expect(parseGscSiteList({})).toEqual([]);
    expect(parseGscSiteList({ siteEntry: { siteUrl: 'x' } })).toEqual([]);
  });
});

describe('gscSiteMatchesWebsite', () => {
  it('matches URL-prefix and domain properties', () => {
    expect(hostnameFromWebsite('https://www.anomalia.so/path')).toBe('anomalia.so');
    expect(gscSiteMatchesWebsite('https://www.anomalia.so/', 'https://anomalia.so')).toBe(true);
    expect(gscSiteMatchesWebsite('sc-domain:anomalia.so', 'https://www.anomalia.so')).toBe(true);
    expect(gscSiteMatchesWebsite('sc-domain:anomalia.so', 'https://app.anomalia.so')).toBe(true);
    expect(gscSiteMatchesWebsite('https://other.com/', 'https://anomalia.so')).toBe(false);
  });

  it('ranks matching and selected properties first', () => {
    const ranked = rankGscSites(
      [
        { siteUrl: 'https://other.com/', permissionLevel: 'siteOwner' },
        { siteUrl: 'sc-domain:anomalia.so', permissionLevel: 'siteOwner' },
        { siteUrl: 'https://blog.example.com/', permissionLevel: 'siteFullUser' }
      ],
      'https://anomalia.so',
      'https://blog.example.com/'
    );
    expect(ranked[0]?.siteUrl).toBe('sc-domain:anomalia.so');
  });
});
