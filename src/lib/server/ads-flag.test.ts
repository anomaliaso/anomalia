import { beforeEach, describe, expect, it, vi } from 'vitest';

// $env/dynamic/private is resolved by the SvelteKit plugin; give the unit test a plain object
// whose values we flip per case.
const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { adsAvailable, adsFeatureEnabled } = await import('./ads');
const { adsSelfServeEnabled, ADS_SELF_SERVE } = await import('$lib/ads-fee');
// La allowlist ora vive in internal-users (server, da env): le email NON stanno più nel sorgente
// — e quindi nemmeno in questo test: si iniettano via env, come ogni altro flag qui.
env.ADS_PREVIEW_EMAILS = 'preview-a@example.com, Preview-B@Example.com';
const { isAdsPreviewUser } = await import('$lib/server/internal-users');

describe('ads kill switch', () => {
  beforeEach(() => {
    delete env.FEATURE_ADS;
  });

  it('is OFF when FEATURE_ADS is unset — the default everywhere it is not explicitly enabled', () => {
    expect(adsFeatureEnabled()).toBe(false);
    expect(adsAvailable('pro')).toBe(false);
  });

  it('stays OFF for any value other than the exact string "true"', () => {
    for (const v of ['false', '1', 'yes', 'TRUE', '']) {
      env.FEATURE_ADS = v;
      expect(adsFeatureEnabled()).toBe(false);
    }
  });

  // The two gates are independent: the flag says the feature exists, the plan says who may use it.
  it('requires BOTH the flag and an ads-bearing plan', () => {
    env.FEATURE_ADS = 'true';
    expect(adsAvailable('pro')).toBe(true);
    expect(adsAvailable('starter')).toBe(true);
    expect(adsAvailable(null)).toBe(false);

    env.FEATURE_ADS = 'false';
    expect(adsAvailable('pro')).toBe(false);
  });

  it('lets preview allowlist users through even when FEATURE_ADS is off', () => {
    expect(isAdsPreviewUser('preview-a@example.com')).toBe(true);
    expect(isAdsPreviewUser('preview-b@example.com')).toBe(true); // case-insensitive
    expect(isAdsPreviewUser('other@example.com')).toBe(false);

    expect(adsFeatureEnabled('preview-a@example.com')).toBe(true);
    expect(adsAvailable('go', 'preview-b@example.com')).toBe(true);
    expect(adsSelfServeEnabled(isAdsPreviewUser('preview-a@example.com'))).toBe(true);
    expect(adsSelfServeEnabled(isAdsPreviewUser('stranger@example.com'))).toBe(ADS_SELF_SERVE);
  });
});
