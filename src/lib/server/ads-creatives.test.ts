import { describe, expect, it } from 'vitest';
import { buildCreatePayload, mapAdAccount } from './zernio-ads';

const base = {
  accountId: 'acc',
  adAccountId: 'act_1',
  name: 'Campagna',
  goal: 'traffic' as const,
  budget: { amount: 25, type: 'daily' as const },
  creative: { headline: 'H1', body: 'B1', imageUrl: 'https://x/1.jpg', linkUrl: 'https://x' }
};

describe('buildCreatePayload multi-creative', () => {
  it('keeps the legacy single shape when there are no variants', () => {
    const p = buildCreatePayload({ ...base, platform: 'metaads' });
    expect(p.headline).toBe('H1');
    expect(p.creatives).toBeUndefined();
  });

  it('switches shape and drops the top-level copy Zernio would ignore', () => {
    const p = buildCreatePayload({
      ...base,
      platform: 'metaads',
      validateOnly: true,
      creatives: [
        { name: 'a', headline: 'H1', body: 'B1', imageUrl: 'https://x/1.jpg', linkUrl: 'https://x' },
        { name: 'b', headline: 'H2', videoUrl: 'https://x/2.mp4', linkUrl: 'https://x' }
      ]
    });
    expect(p.creatives).toHaveLength(2);
    for (const k of ['headline', 'body', 'imageUrl', 'linkUrl', 'callToAction', 'validateOnly']) {
      expect(p[k]).toBeUndefined();
    }
    // Budget and targeting stay at the top: the ad set owns them, and that is the whole point.
    expect(p.budgetAmount).toBe(25);
    // A video entry travels as an object, not a bare url.
    expect((p.creatives as { video?: unknown }[])[1].video).toEqual({ url: 'https://x/2.mp4' });
  });

  it('ignores variants on Google, which recombines inside one responsive ad', () => {
    const p = buildCreatePayload({
      ...base,
      platform: 'googleads',
      creatives: [{ headline: 'H2' }]
    });
    expect(p.creatives).toBeUndefined();
    expect(p.headline).toBe('H1');
  });
});

describe('placementAssets', () => {
  it('pins the vertical asset to Stories/Reels and keeps the feed one as default', () => {
    const p = buildCreatePayload({
      ...base,
      platform: 'metaads',
      creative: { ...base.creative, storyImageUrl: 'https://x/9x16.jpg' }
    });
    expect(p.imageUrl).toBeUndefined();
    expect(p.placementAssets).toEqual({
      defaultImageUrl: 'https://x/1.jpg',
      rules: [
        {
          placements: {
            instagramPositions: ['story', 'reels'],
            facebookPositions: ['story', 'facebook_reels']
          },
          imageUrl: 'https://x/9x16.jpg'
        }
      ]
    });
  });

  it('never sends it alongside creatives[] — Meta rejects the pair', () => {
    const p = buildCreatePayload({
      ...base,
      platform: 'metaads',
      creative: { ...base.creative, storyImageUrl: 'https://x/9x16.jpg' },
      creatives: [{ headline: 'H2' }]
    });
    expect(p.placementAssets).toBeUndefined();
    expect(p.creatives).toHaveLength(1);
  });

  it('is Meta-only', () => {
    const p = buildCreatePayload({
      ...base,
      platform: 'googleads',
      creative: { ...base.creative, storyImageUrl: 'https://x/9x16.jpg' }
    });
    expect(p.placementAssets).toBeUndefined();
    expect(p.imageUrl).toBe('https://x/1.jpg');
  });
});

describe('ad account usability', () => {
  it('marks a non-selectable account inactive so it cannot be picked to spend on', () => {
    expect(mapAdAccount({ id: 'act_1', selectable: false })?.status).toBe('inactive');
    expect(mapAdAccount({ id: 'act_2', unusableReason: 'ACCOUNT_DISABLED' })?.status).toBe('inactive');
    expect(mapAdAccount({ id: 'act_3', selectable: true })?.status).toBe('active');
    // LinkedIn is the one platform that reports `status`; it must still win.
    expect(mapAdAccount({ id: 'act_4', status: 'active', selectable: false })?.status).toBe('active');
  });

  it('carries the platform reason so the checklist can say WHY instead of "not found"', () => {
    expect(mapAdAccount({ id: 'a', unusableReason: 'UNSETTLED' })?.unusableReason).toBe('UNSETTLED');
    // Meta usually refuses without giving a reason — say that rather than render an empty cause.
    expect(mapAdAccount({ id: 'b', selectable: false })?.unusableReason).toBe('NOT_SELECTABLE');
    expect(mapAdAccount({ id: 'c', selectable: true })?.unusableReason).toBeNull();
  });
});
