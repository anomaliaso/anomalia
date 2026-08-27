import { describe, expect, it } from 'vitest';
import {
  parseVideoStandard,
  inferVideoStandard,
  dimensionsFor,
  clampScore,
  verdictFromScores,
  finalizeVideoReview,
  extraReviewOpts,
  visualUrlsFromPost,
  ORGANIC_DIMENSIONS,
  ADS_DIMENSIONS,
  type VideoReviewIssue
} from './video-review';

describe('parseVideoStandard', () => {
  it('maps organic aliases', () => {
    expect(parseVideoStandard('organic')).toBe('organic');
    expect(parseVideoStandard('UGC')).toBe('organic');
    expect(parseVideoStandard('reel')).toBe('organic');
  });
  it('maps ads aliases', () => {
    expect(parseVideoStandard('ads')).toBe('ads');
    expect(parseVideoStandard('ugc_ad')).toBe('ads');
    expect(parseVideoStandard('paid')).toBe('ads');
  });
  it('rejects unknown', () => {
    expect(parseVideoStandard('')).toBeNull();
    expect(parseVideoStandard('carousel')).toBeNull();
  });
});

describe('inferVideoStandard', () => {
  it('defaults organic', () => {
    expect(inferVideoStandard({})).toBe('organic');
    expect(inferVideoStandard({ durationSeconds: 15 })).toBe('organic');
  });
  it('treats ugc ads and ~22s clips as ads', () => {
    expect(inferVideoStandard({ ugcAd: true })).toBe('ads');
    expect(inferVideoStandard({ durationSeconds: 22 })).toBe('ads');
    expect(inferVideoStandard({ durationSeconds: 21 })).toBe('ads');
  });
});

describe('dimensionsFor', () => {
  it('organic has soft CTA + loop, not offer/proof', () => {
    expect(dimensionsFor('organic')).toEqual(ORGANIC_DIMENSIONS);
    expect(ORGANIC_DIMENSIONS).toContain('cta_soft');
    expect(ORGANIC_DIMENSIONS).not.toContain('offer');
  });
  it('both standards carry anatomy', () => {
    expect(ORGANIC_DIMENSIONS).toContain('anatomy');
    expect(ADS_DIMENSIONS).toContain('anatomy');
  });
  it('ads has offer/proof/uniqueness, not loop', () => {
    expect(dimensionsFor('ads')).toEqual(ADS_DIMENSIONS);
    expect(ADS_DIMENSIONS).toContain('offer');
    expect(ADS_DIMENSIONS).toContain('uniqueness');
    expect(ADS_DIMENSIONS).not.toContain('loop_worthiness');
  });
});

describe('clampScore', () => {
  it('clamps to 1–10 integers', () => {
    expect(clampScore(0)).toBe(1);
    expect(clampScore(11)).toBe(10);
    expect(clampScore(7.4)).toBe(7);
    expect(clampScore('8')).toBe(8);
    expect(clampScore('nope')).toBe(1);
  });
});

describe('verdictFromScores — coverage gating', () => {
  const full = {
    scroll_stop: 9,
    sound_off: 8,
    hold: 8,
    authenticity: 8,
    anatomy: 9,
    structure: 8,
    spoken_craft: 8,
    cta_soft: 8,
    loop_worthiness: 8
  };

  it('reports how much of the clip was actually judged', () => {
    const r = verdictFromScores(full, 'organic', []);
    expect(r.evidence.coverage).toBe(100);
    expect(r.evidence.tier).toBe('full');
    expect(r.evidence.unknownDimensions).toEqual([]);
  });

  it('refuses to SHIP on partial evidence, however good the scores that came back', () => {
    // Same strong numbers, but two dimensions were never scored.
    const { anatomy, cta_soft, loop_worthiness, ...partial } = full;
    void anatomy;
    void cta_soft;
    void loop_worthiness;
    const r = verdictFromScores(partial, 'organic', []);
    expect(r.evidence.tier).not.toBe('full');
    expect(r.verdict).toBe('fix');
    expect(r.evidence.unknownDimensions).toEqual(['anatomy', 'cta_soft', 'loop_worthiness']);
  });

  it('never lets an unscored gate dimension trigger a kill', () => {
    // scroll_stop absent: the old code read it as 1 and killed the clip on a score nobody gave.
    const { scroll_stop, ...noStop } = full;
    void scroll_stop;
    expect(verdictFromScores(noStop, 'organic', []).verdict).not.toBe('kill');
  });

  it('never lets an unscored offer satisfy the ads ship bar', () => {
    // The old code read a missing offer as 10 for the ship test and as 10 for the kill test.
    const ads = {
      scroll_stop: 9,
      sound_off: 8,
      hold: 8,
      authenticity: 8,
      anatomy: 9,
      structure: 8,
      spoken_craft: 8,
      audience_signal: 8,
      proof: 8,
      uniqueness: 8,
      claims_safe: 8
    };
    const r = verdictFromScores(ads, 'ads', []);
    expect(r.verdict).toBe('fix');
  });

  it('still kills on a scored gate failure even when coverage is thin', () => {
    // Thin evidence must not rescue a 2/10 hook: the judge DID look at it.
    const r = verdictFromScores({ scroll_stop: 2, sound_off: 3 }, 'ads', []);
    expect(r.verdict).toBe('kill');
    expect(r.evidence.tier).toBe('ungraded');
  });

  it('does not kill on an average computed over a fraction of the dimensions', () => {
    const r = verdictFromScores({ sound_off: 3, structure: 3 }, 'ads', []);
    expect(r.evidence.tier).toBe('ungraded');
    expect(r.verdict).toBe('fix');
  });
});

describe('verdictFromScores', () => {
  const strongOrganic = {
    scroll_stop: 8,
    sound_off: 8,
    hold: 7,
    authenticity: 8,
    anatomy: 8,
    structure: 7,
    spoken_craft: 7,
    cta_soft: 7,
    loop_worthiness: 7
  };
  const none: VideoReviewIssue[] = [];

  it('ships a strong organic clip', () => {
    expect(verdictFromScores(strongOrganic, 'organic', none).verdict).toBe('ship');
  });

  it('kills a dead hook even if the rest is fine', () => {
    expect(verdictFromScores({ ...strongOrganic, scroll_stop: 3 }, 'organic', none).verdict).toBe('kill');
  });

  it('kills on broken anatomy (extra limb territory) even if the rest is fine', () => {
    expect(verdictFromScores({ ...strongOrganic, anatomy: 2 }, 'organic', none).verdict).toBe('kill');
  });

  it('never ships doubtful anatomy — 5/10 blocks ship, does not kill', () => {
    const r = verdictFromScores({ ...strongOrganic, anatomy: 5 }, 'organic', none);
    expect(r.verdict).toBe('fix');
  });

  it('kills an ad with no offer', () => {
    const ads = {
      scroll_stop: 8,
      sound_off: 7,
      hold: 7,
      authenticity: 7,
      anatomy: 8,
      structure: 7,
      spoken_craft: 7,
      audience_signal: 7,
      proof: 7,
      offer: 2,
      uniqueness: 7,
      claims_safe: 8
    };
    expect(verdictFromScores(ads, 'ads', none).verdict).toBe('kill');
  });

  it('fixes a mid clip and blocks ship on a critical issue', () => {
    const mid = { ...strongOrganic, scroll_stop: 6, authenticity: 6 };
    expect(verdictFromScores(mid, 'organic', none).verdict).toBe('fix');
    expect(
      verdictFromScores(strongOrganic, 'organic', [
        { dimension: 'hold', severity: 'critical', at_s: 4, problem: 'dead', fix: 'cut' }
      ]).verdict
    ).toBe('fix');
  });
});

describe('finalizeVideoReview', () => {
  it('owns verdict, drops empty issues, clamps scores to the standard', () => {
    const review = finalizeVideoReview(
      {
        doomscroll_stops: true,
        doomscroll_who: 'social managers drowning in captions',
        doomscroll_reason: 'specific pain in the first line',
        hook_at_s: 1.2,
        hook_type: 'pain_callout',
        hook_line: 'Stai buttando soldi sul social manager',
        hook_visual: 'lean-in, brows knit',
        hook_callout: true,
        hook_open_loop: true,
        hook_promise_match: true,
        hook_unique: true,
        reveal_at_s: 6,
        cta_at_s: 13,
        dead_seconds: [4, 'x', -1],
        scores: {
          scroll_stop: 8,
          sound_off: 7,
          hold: 7,
          authenticity: 8,
          anatomy: 9,
          structure: 7,
          spoken_craft: 7,
          cta_soft: 8,
          loop_worthiness: 6,
          offer: 9
        },
        issues: [{ dimension: 'hold', severity: 'nit', problem: 'one pause', fix: 'cut 4s' }, { problem: '' }],
        weakest_link: 'loop_worthiness',
        next_test: 'Because loop_worthiness, swap the last line for a save-prompt; judge on saves.',
        summary: 'Stops the right people. Soft CTA is fine.'
      },
      { standard: 'organic', duration_s: 14.2 }
    );
    expect(review.verdict).toBe('ship');
    expect(review.overall).toBeGreaterThanOrEqual(7);
    expect(review.scores.offer).toBeUndefined();
    expect(review.dead_seconds).toEqual([4]);
    expect(review.issues).toHaveLength(1);
    expect(review.hook.callout).toBe(true);
    expect(review.duration_s).toBe(14.2);
    expect(review.script).toEqual({ spoken: '', on_screen: '', caption: '' });
    expect(review.judgment).toBe('Stops the right people. Soft CTA is fine.');
  });

  it('kills when the model tries to ship a 2/10 hook', () => {
    const review = finalizeVideoReview(
      {
        doomscroll_stops: false,
        doomscroll_reason: 'logo intro',
        hook_callout: false,
        hook_open_loop: false,
        scores: {
          scroll_stop: 2,
          sound_off: 3,
          hold: 8,
          authenticity: 8,
          structure: 8,
          spoken_craft: 8
        },
        issues: [],
        weakest_link: 'scroll_stop',
        next_test: 'Replace the first 3s.',
        summary: 'Pretty but skipped.'
      },
      { standard: 'ads', duration_s: 22 }
    );
    expect(review.verdict).toBe('kill');
    expect(review.doomscroll.stops).toBe(false);
  });

  it('stores spoken / on-screen script and judgment with the vote', () => {
    const review = finalizeVideoReview(
      {
        doomscroll_stops: true,
        doomscroll_reason: 'pain callout',
        hook_callout: true,
        hook_open_loop: true,
        scores: {
          scroll_stop: 8,
          sound_off: 7,
          hold: 7,
          authenticity: 8,
          anatomy: 9,
          structure: 7,
          spoken_craft: 8,
          cta_soft: 7,
          loop_worthiness: 7
        },
        issues: [],
        weakest_link: 'hold',
        next_test: 'Because hold, cut the mid pause; judge on 3s hold.',
        summary: 'Stops. Script is the product.',
        judgment: 'Hook names the person, not the app.',
        script_spoken: 'Non sei in sovrappeso perché mangi troppo',
        script_on_screen: 'STOP GUESSING',
        caption: 'Prova Sona'
      },
      { standard: 'organic', duration_s: 12 }
    );
    expect(review.script.spoken).toMatch(/sovrappeso/);
    expect(review.script.on_screen).toBe('STOP GUESSING');
    expect(review.script.caption).toBe('Prova Sona');
    expect(review.judgment).toMatch(/Hook names/);
  });
});

describe('visualUrlsFromPost / extraReviewOpts', () => {
  it('collects cover + slides and tags carousels', () => {
    const urls = visualUrlsFromPost({
      media_url: 'https://x.co/a.jpg',
      media_urls: ['https://x.co/a.jpg', 'https://x.co/b.png']
    });
    expect(urls).toEqual(['https://x.co/a.jpg', 'https://x.co/b.png']);
    expect(
      extraReviewOpts({
        url: urls[0],
        slideUrls: urls.slice(1),
        contentType: 'generated_image'
      }).kind
    ).toBe('carousel');
  });
});
