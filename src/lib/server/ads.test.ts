import { describe, expect, it } from 'vitest';
import {
  BOOSTABLE_PLATFORMS,
  SOCIAL_ADS_PLATFORMS,
  parseAdsSettings,
  recommendBoostBudget,
  toAdsPlatform,
  toZernioPlatform,
  feeBreakdown,
  AD_MANAGEMENT_FEE_RATE
} from './ads';
import { creditsForSpend } from '$lib/ads-fee';
import { creditedSpend, creditsDue } from './ads-credits';
import { buildCreatePayload } from './zernio-ads';

describe('ads helpers', () => {
  it('maps social platforms to Zernio ads keys', () => {
    expect(toAdsPlatform('instagram')).toBe('metaads');
    expect(toAdsPlatform('facebook')).toBe('metaads');
    expect(toAdsPlatform('tiktok')).toBe('tiktokads');
    expect(toAdsPlatform('linkedin')).toBe('linkedinads');
    expect(toAdsPlatform('x')).toBe('xads');
    expect(toAdsPlatform('google')).toBe('googleads');
    expect(toAdsPlatform('googleads')).toBe('googleads');
  });

  it('maps stored platforms to the Zernio duplicate/delete enum', () => {
    expect(toZernioPlatform('metaads')).toBe('facebook');
    expect(toZernioPlatform('facebook')).toBe('facebook');
    expect(toZernioPlatform('tiktokads')).toBe('tiktok');
    expect(toZernioPlatform('linkedinads')).toBe('linkedin');
    // Platforms Zernio cannot duplicate/delete at campaign level (501) resolve to undefined.
    expect(toZernioPlatform('googleads')).toBeUndefined();
    expect(toZernioPlatform('xads')).toBeUndefined();
    expect(toZernioPlatform('pinterestads')).toBeUndefined();
  });

  it('knows which platforms support organic boost', () => {
    // Social ads are Meta-only for now.
    expect(BOOSTABLE_PLATFORMS.has('instagram')).toBe(true);
    expect(BOOSTABLE_PLATFORMS.has('facebook')).toBe(true);
    expect(BOOSTABLE_PLATFORMS.has('tiktok')).toBe(false);
    expect(BOOSTABLE_PLATFORMS.has('linkedin')).toBe(false);
    expect(BOOSTABLE_PLATFORMS.has('google')).toBe(false);
  });

  it('limits the social ads channel to Meta', () => {
    expect([...SOCIAL_ADS_PLATFORMS]).toEqual(['metaads']);
  });

  it('parses ads_settings safely', () => {
    expect(parseAdsSettings(null)).toEqual({});
    expect(
      parseAdsSettings({
        dailyBudgetCap: 40,
        monthlyBudgetCap: '500',
        defaultCountries: ['it', 'US', 'xx', 'DE', 'ITALY'],
        defaultCurrency: 'EUR',
        dsaBeneficiary: 'Acme SRL'
      })
    ).toEqual({
      dailyBudgetCap: 40,
      monthlyBudgetCap: 500,
      defaultCountries: ['IT', 'US', 'XX', 'DE'],
      defaultCurrency: 'EUR',
      dsaBeneficiary: 'Acme SRL',
      dsaPayor: undefined
    });
  });

  it('applies a management fee on platform budget', () => {
    expect(AD_MANAGEMENT_FEE_RATE).toBe(0.12);
    expect(feeBreakdown(100)).toEqual({
      platformBudget: 100,
      fee: 12,
      total: 112,
      feeRate: 0.12
    });
    expect(feeBreakdown(25).fee).toBe(3);
  });

  // Launching and keeping ads alive draws down AI credits — the fee is metered, not invoiced.
  it('bills the management fee in credits, only on new spend', () => {
    expect(creditsForSpend(25)).toBe(300); // €25/day → €3 fee → 300 credits

    // A re-run of the same sync must charge nothing: the delta, not the total, is billed.
    expect(creditsDue(100, 100)).toBe(0);
    expect(creditsDue(150, 100)).toBe(creditsForSpend(50));
    // Platform restatements can move spend backwards — never refund into a charge.
    expect(creditsDue(80, 100)).toBe(0);

    expect(creditedSpend({ creditedSpend: 42 })).toBe(42);
    expect(creditedSpend(null)).toBe(0);
    expect(creditedSpend({ creditedSpend: 'nope' })).toBe(0);
  });

  it('flattens the create payload the way /v1/ads/create wants it', () => {
    const google = buildCreatePayload({
      accountId: 'acc_1',
      adAccountId: '987-654',
      name: 'Search IT',
      goal: 'traffic',
      budget: { amount: 30, type: 'daily', currency: 'EUR' },
      platform: 'googleads',
      campaignType: 'SEARCH',
      targeting: { countries: ['IT'], age_min: 25, keywords: [{ text: 'crm per pmi' }] },
      creative: { headline: 'CRM per PMI', body: 'Prova gratis', landingPageUrl: 'https://x.it' }
    });

    // Flat, not nested: no `budget`/`creative`/`targeting` objects and no `platform` field.
    expect(google.budget).toBeUndefined();
    expect(google.creative).toBeUndefined();
    expect(google.targeting).toBeUndefined();
    expect(google.platform).toBeUndefined();
    expect(google.budgetAmount).toBe(30);
    expect(google.budgetType).toBe('daily');
    expect(google.countries).toEqual(['IT']);
    expect(google.ageMin).toBe(25);
    expect(google.linkUrl).toBe('https://x.it');
    expect(google.campaignType).toBe('search'); // Google wants it lowercase
    expect(google.keywords).toEqual(['crm per pmi']); // flat strings, not objects

    // Display needs the image pair under `images`; Search/Meta keep a single imageUrl.
    const display = buildCreatePayload({
      accountId: 'acc_1',
      adAccountId: '987-654',
      name: 'Display',
      goal: 'traffic',
      budget: { amount: 20, type: 'daily' },
      platform: 'googleads',
      campaignType: 'DISPLAY',
      creative: {
        headline: 'Torna a trovarci',
        imageUrl: 'https://x.it/l.jpg',
        squareImageUrl: 'https://x.it/s.jpg',
        businessName: 'Acme'
      }
    });
    expect(display.images).toEqual({ landscape: 'https://x.it/l.jpg', square: 'https://x.it/s.jpg' });
    expect(display.imageUrl).toBeUndefined();
    expect(display.businessName).toBe('Acme');

    const meta = buildCreatePayload({
      accountId: 'acc_2',
      adAccountId: 'act_1',
      name: 'Meta',
      goal: 'engagement',
      budget: { amount: 15, type: 'daily' },
      platform: 'metaads',
      targeting: { countries: ['IT'], interests: [{ id: '123' }], keywords: [{ text: 'ignored' }] },
      creative: { headline: 'Ciao', imageUrl: 'https://x.it/i.jpg' }
    });
    expect(meta.imageUrl).toBe('https://x.it/i.jpg');
    expect(meta.images).toBeUndefined();
    expect(meta.interests).toEqual([{ id: '123' }]);
    expect(meta.keywords).toBeUndefined(); // keywords are a Google concept
  });

  it('recommends budget within the daily cap', () => {
    const low = recommendBoostBudget({ dailyBudgetCap: 50, defaultCurrency: 'EUR' }, null);
    expect(low.amount).toBeGreaterThanOrEqual(5);
    expect(low.amount).toBeLessThanOrEqual(50);

    const hot = recommendBoostBudget(
      { dailyBudgetCap: 50, defaultCurrency: 'EUR' },
      { likes: 400, comments: 80, shares: 40, impressions: 50_000, engagementRate: 0.05 }
    );
    expect(hot.amount).toBeGreaterThanOrEqual(low.amount);
    expect(hot.amount).toBeLessThanOrEqual(50);
  });
});
