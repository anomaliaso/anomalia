import { describe, it, expect } from 'vitest';
import {
  isPlanKey,
  isPaidPlan,
  canConnectSocials,
  hasSocialPublishing,
  hasBlogIntegrations,
  hasBlogCustomDomain,
  hasWebHub,
  hasLeadFinding,
  hasAds,
  hasBacklinkNetwork,
  hasMotionVideo4k,
  hasFullChatContext,
  CHAT_CONTEXT_CAP_TOKENS,
  leadEngagePlatforms,
  radarSourceLimit,
  isRadarKindAllowed,
  RADAR_BASE_KINDS,
  RADAR_PRO_LEAD_KINDS,
  RADAR_PLATFORM_KEYS,
  RADAR_SOURCE_LIMITS,
  visiblePlans,
  planByKey,
  PLANS,
  featText,
  videosFromCredits,
  VIDEO_COST_USD_HD,
  VIDEO_COST_CREDITS
} from './plans';
import {
  RADAR_BASE_SOURCE_KINDS,
  RADAR_PLATFORMS,
  RADAR_PRO_SOURCE_KINDS
} from '@anomalia/api-contracts';

describe('Go plan helpers', () => {
  it('recognises go as a plan key and a paid tier', () => {
    expect(isPlanKey('go')).toBe(true);
    expect(isPaidPlan('go')).toBe(true);
  });

  it('blocks Zernio connects and CMS sync on Go (radar/leads stay on)', () => {
    expect(hasSocialPublishing('go')).toBe(false);
    expect(canConnectSocials('go', 'active')).toBe(false);
    expect(hasBlogIntegrations('go')).toBe(false);
    expect(hasBlogCustomDomain('go')).toBe(true);
    expect(hasLeadFinding('go')).toBe(true);
    expect(hasWebHub('go')).toBe(true);
  });

  it('unlocks Meta & Google Ads from Starter up (not Go/Free)', () => {
    expect(hasAds(null)).toBe(false);
    expect(hasAds('go')).toBe(false);
    expect(hasAds('starter')).toBe(true);
    expect(hasAds('pro')).toBe(true);
    expect(hasAds('scale')).toBe(true);
    expect(planByKey('starter').highlights.some((h) => /Meta|& Google Ads/i.test(h))).toBe(true);
    expect(planByKey('go').highlights.some((h) => /Meta|& Google Ads/i.test(h))).toBe(false);
  });

  it('gives the full chat context window to Starter and up, caps Free/Go', () => {
    expect(hasFullChatContext(null)).toBe(false);
    expect(hasFullChatContext('go')).toBe(false);
    expect(hasFullChatContext('starter')).toBe(true);
    expect(hasFullChatContext('pro')).toBe(true);
    expect(hasFullChatContext('scale')).toBe(true);
    expect(CHAT_CONTEXT_CAP_TOKENS).toBe(256_000);
  });

  it('unlocks 4K Motion video encode on Pro (and legacy scale)', () => {
    expect(hasMotionVideo4k(null)).toBe(false);
    expect(hasMotionVideo4k('go')).toBe(false);
    expect(hasMotionVideo4k('starter')).toBe(false);
    expect(hasMotionVideo4k('pro')).toBe(true);
    expect(hasMotionVideo4k('scale')).toBe(true);
    expect(planByKey('pro').highlights.some((h) => /4K images \/ videos/i.test(h))).toBe(true);
    expect(planByKey('starter').highlights.some((h) => /4K/i.test(h))).toBe(false);
    expect(planByKey('go').highlights.some((h) => /4K/i.test(h))).toBe(false);
  });

  it('unlocks backlink network from Starter up (not Go/Free)', () => {
    expect(hasBacklinkNetwork(null)).toBe(false);
    expect(hasBacklinkNetwork('go')).toBe(false);
    expect(hasBacklinkNetwork('starter')).toBe(true);
    expect(hasBacklinkNetwork('pro')).toBe(true);
    expect(hasBacklinkNetwork('scale')).toBe(true);
    expect(planByKey('starter').highlights.some((h) => /backlink/i.test(h))).toBe(true);
    expect(planByKey('pro').highlights.some((h) => /backlink/i.test(h))).toBe(true);
    expect(planByKey('go').highlights.some((h) => /backlink/i.test(h))).toBe(false);
    const goSeo = planByKey('go').feats.find((g) => g.label === 'SEO & blog')!;
    expect(goSeo.items.some((f) => typeof f === 'object' && f.missing && /backlink/i.test(f.text))).toBe(
      true
    );
  });

  it('keeps pricing cards to a short highlight list', () => {
    for (const p of PLANS) {
      expect(p.highlights.length).toBeGreaterThanOrEqual(4);
      expect(p.highlights.length).toBeLessThanOrEqual(6);
    }
  });

  it('keeps en.json plan card copy in sync with PLANS highlights', async () => {
    const en = (await import('$lib/i18n/locales/en.json')).default as {
      pricing: { plans: Record<string, { tagline: string; highlights: string }> };
    };
    for (const p of PLANS) {
      const loc = en.pricing.plans[p.key];
      expect(loc?.tagline).toBe(p.tagline);
      const bullets = loc.highlights.split('|').map((s) => s.trim()).filter(Boolean);
      expect(bullets).toEqual(p.highlights);
    }
  });

  it('ships localized plan card copy for it/es/fr with matching highlight counts', async () => {
    const locales = ['it', 'es', 'fr'] as const;
    for (const code of locales) {
      const pack = (await import(`$lib/i18n/locales/${code}.json`)).default as {
        pricing: { plans: Record<string, { tagline: string; highlights: string }> };
      };
      for (const p of PLANS) {
        const loc = pack.pricing.plans[p.key];
        expect(loc?.tagline?.length).toBeGreaterThan(0);
        const bullets = loc.highlights.split('|').map((s) => s.trim()).filter(Boolean);
        expect(bullets.length).toBe(p.highlights.length);
      }
    }
  });

  it('lists SEO & GEO on Go (free matches Go web hub)', () => {
    const go = PLANS.find((p) => p.key === 'go')!;
    const seoBlog = go.feats.find((g) => g.label === 'SEO & blog');
    expect(seoBlog).toBeTruthy();
    expect(seoBlog!.items.some((f) => featText(f).includes('SEO & GEO'))).toBe(true);
  });

  it('unlocks Web hub + Radar/Leads on free (match Go)', () => {
    expect(hasWebHub(null)).toBe(true);
    expect(hasWebHub(undefined)).toBe(true);
    expect(hasLeadFinding(null)).toBe(true);
    expect(hasBlogIntegrations(null)).toBe(false);
    expect(hasBlogCustomDomain(null)).toBe(false);
    expect(hasSocialPublishing(null)).toBe(false);
    expect(canConnectSocials(null, 'trial')).toBe(false);
  });

  it('grants custom blog domain on every paid tier', () => {
    expect(hasBlogCustomDomain('go')).toBe(true);
    expect(hasBlogCustomDomain('starter')).toBe(true);
    expect(hasBlogCustomDomain('pro')).toBe(true);
    expect(hasBlogCustomDomain('scale')).toBe(true);
    expect(hasBlogCustomDomain(null)).toBe(false);
  });

  it('grants comment/DM lead platforms by plan, without needing a connected account', () => {
    expect(leadEngagePlatforms(null)).toEqual(['reddit']);
    expect(leadEngagePlatforms('go')).toEqual(['reddit']);
    expect(leadEngagePlatforms('starter')).toEqual(['reddit']);
    expect(leadEngagePlatforms('pro')).toEqual(['reddit', 'threads', 'x', 'linkedin']);
    expect(leadEngagePlatforms('scale')).toEqual(['reddit', 'threads', 'x', 'linkedin']);
  });

  it('caps custom Radar sources by plan (free/Go 5 / Starter 10 / Pro 30)', () => {
    expect(radarSourceLimit(null)).toBe(5);
    expect(radarSourceLimit('go')).toBe(5);
    expect(radarSourceLimit('starter')).toBe(10);
    expect(radarSourceLimit('pro')).toBe(30);
    expect(radarSourceLimit('scale')).toBe(30);
    expect(radarSourceLimit('enterprise-2029')).toBe(RADAR_SOURCE_LIMITS.go);
    for (const p of PLANS) {
      expect(radarSourceLimit(p.key)).toBe(p.radarSources);
      expect(RADAR_SOURCE_LIMITS[p.key]).toBe(p.radarSources);
    }
  });

  it('still allows connects on Starter/Pro when active', () => {
    expect(canConnectSocials('starter', 'active')).toBe(true);
    expect(canConnectSocials('pro', 'active')).toBe(true);
    expect(canConnectSocials('starter', 'trial')).toBe(false);
  });

  it('hides Go from pricing when the flag is off', () => {
    expect(visiblePlans(false).map((p) => p.key)).toEqual(['starter', 'pro']);
    expect(visiblePlans(true).map((p) => p.key)).toEqual(['go', 'starter', 'pro']);
  });

  it('defaults planByKey to Pro', () => {
    expect(planByKey(null).key).toBe('pro');
    expect(planByKey('go').name).toBe('Go');
    expect(planByKey('go').m).toBe(25);
    expect(planByKey('go').mUsd).toBe(29);
  });

  it('estimates HD videos as plan credits ÷ ($0.38 × 100)', () => {
    expect(VIDEO_COST_USD_HD).toBe(0.38);
    expect(VIDEO_COST_CREDITS).toBe(38);
    // Go 2100 → 55, Starter 5500 → 144, Pro 12000 → 315
    expect(videosFromCredits(2100)).toBe(55);
    expect(videosFromCredits(5500)).toBe(144);
    expect(videosFromCredits(12000)).toBe(315);
    for (const key of ['go', 'starter', 'pro'] as const) {
      const p = planByKey(key);
      expect(videosFromCredits(p.credits)).toBe(Math.floor(p.credits / VIDEO_COST_CREDITS));
    }
  });

  // Il "valore API" accanto ai crediti è stato rimosso: a listino pieno 100 crediti = $1, quindi
  // i numeri di marketing (€50 sui 2100 crediti del Go) erano falsi, e quelli veri dicono che il
  // cliente paga più del valore che riceve. Questo test è la lapide: i piani espongono la
  // dotazione di crediti e basta, e nessuno rimette una conversione in euro per abitudine.
  it('sells the credit allowance, never a euro value of somebody else API list price', () => {
    for (const key of ['go', 'starter', 'pro'] as const) {
      expect(planByKey(key).credits).toBeGreaterThan(0);
    }
    for (const p of PLANS) {
      expect(Object.keys(p).filter((k) => /^apiValue/.test(k))).toEqual([]);
    }
  });
});

describe('il vocabolario del Radar che un agente puo usare', () => {
  it('e esattamente quello del prodotto: piattaforme e tipi di fonte', () => {
    // Il contratto non puo' importare `$lib`, quindi i tre elenchi vivono anche li'. Uno che
    // diverge sarebbe un tool che offre una fonte che il salvataggio rifiuta, o che ne nasconde
    // una che esiste.
    expect([...RADAR_PLATFORMS]).toEqual([...RADAR_PLATFORM_KEYS]);
    expect([...RADAR_BASE_SOURCE_KINDS]).toEqual([...RADAR_BASE_KINDS]);
    expect([...RADAR_PRO_SOURCE_KINDS]).toEqual([...RADAR_PRO_LEAD_KINDS]);
  });

  it('i tipi che il piano Pro sblocca sono gli stessi che il gate sblocca', () => {
    for (const kind of RADAR_PRO_SOURCE_KINDS) {
      expect(isRadarKindAllowed(kind, 'starter'), kind).toBe(false);
      expect(isRadarKindAllowed(kind, 'pro'), kind).toBe(true);
    }
    for (const kind of RADAR_BASE_SOURCE_KINDS) {
      expect(isRadarKindAllowed(kind, 'go'), kind).toBe(true);
    }
  });
});
