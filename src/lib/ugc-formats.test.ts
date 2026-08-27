import { describe, expect, it } from 'vitest';
import {
  UGC_FORMATS,
  UGC_FORMAT_IDS,
  UGC_GOAL_FORMATS,
  UGC_PLATFORMS,
  batchSizeForKeepers,
  formatBeats,
  formatIsMultiScene,
  platformClipSeconds,
  rotateUgcFormats,
  ugcFormatBrief,
  ugcFormatById,
  ugcPlatformBrief
} from './ugc-formats';

describe('the format catalog', () => {
  it('has one entry per id, with beats that cover the whole clip in order', () => {
    expect(UGC_FORMATS.map((f) => f.id).sort()).toEqual([...UGC_FORMAT_IDS].sort());
    for (const f of UGC_FORMATS) {
      expect(f.beats.length, f.id).toBeGreaterThanOrEqual(4);
      expect(f.beats[0]!.fromPct, f.id).toBe(0);
      expect(f.beats.at(-1)!.toPct, f.id).toBe(1);
      for (let i = 1; i < f.beats.length; i++) {
        // No gaps and no overlaps: a gap is dead air the model fills with whatever it likes.
        expect(f.beats[i]!.fromPct, `${f.id} beat ${i}`).toBe(f.beats[i - 1]!.toPct);
      }
    }
  });

  it('carries the disambiguation and the failure mode — without them a taxonomy collapses', () => {
    for (const f of UGC_FORMATS) {
      expect(f.notToConfuseWith.length, f.id).toBeGreaterThan(20);
      expect(f.failsWhen.length, f.id).toBeGreaterThan(20);
      expect(f.platforms.length, f.id).toBeGreaterThan(0);
    }
  });

  it('knows which formats actually change scene — decide cuts and reference frames', () => {
    // Un talking head in ripresa unica: stacchi e frame extra lì fanno danno, non bene.
    const single = UGC_FORMATS.filter((f) => !f.multiScene).map((f) => f.id);
    expect(single.sort()).toEqual(['problem_solution', 'testimonial']);
    expect(formatIsMultiScene('unboxing')).toBe(true);
    expect(formatIsMultiScene('testimonial')).toBe(false);
    expect(formatIsMultiScene('nope')).toBe(false);
  });

  it('only lets the product lead the frame in the two commerce formats', () => {
    const early = UGC_FORMATS.filter((f) => f.productEarly).map((f) => f.id);
    expect(early.sort()).toEqual(['tiktok_shop', 'tutorial', 'unboxing']);
  });

  it('maps every goal to formats that exist', () => {
    for (const goal of Object.values(UGC_GOAL_FORMATS)) {
      expect(ugcFormatById(goal.primary)).toBeTruthy();
      expect(ugcFormatById(goal.secondary)).toBeTruthy();
      expect(goal.primary).not.toBe(goal.secondary);
    }
  });
});

describe('formatBeats', () => {
  it('scales a format to the clip length without losing the last beat', () => {
    const beats = formatBeats('problem_solution', 15);
    expect(beats.length).toBe(5);
    expect(beats[0]!.start).toBe(0);
    expect(beats.at(-1)!.end).toBe(15);
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i]!.start).toBe(beats[i - 1]!.end);
      expect(beats[i]!.end).toBeGreaterThan(beats[i]!.start);
    }
  });

  it('keeps the same shape at 60s — a format is percentages, not seconds', () => {
    const short = formatBeats('tutorial', 15);
    const long = formatBeats('tutorial', 60);
    expect(long.map((b) => b.key)).toEqual(short.map((b) => b.key));
    expect(long.at(-1)!.end).toBe(60);
    // The steps beat is the longest in both.
    const longest = (bs: typeof short) =>
      bs.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a)).key;
    expect(longest(long)).toBe(longest(short));
  });

  it('gives every beat room on a very short clip instead of dropping the CTA', () => {
    const beats = formatBeats('comparison', 6);
    expect(beats.length).toBe(5);
    for (const b of beats) expect(b.end - b.start).toBeGreaterThan(0);
    expect(beats.at(-1)!.end).toBe(6);
  });

  it('returns nothing for an unknown format instead of inventing an arc', () => {
    expect(formatBeats('nope' as never, 15)).toEqual([]);
  });
});

describe('rotateUgcFormats', () => {
  it('spreads a batch across formats when none is pinned', () => {
    const plan = rotateUgcFormats(10);
    expect(plan.length).toBe(10);
    expect(new Set(plan).size).toBeGreaterThanOrEqual(4);
  });

  it('repeats the pinned format — an explicit choice is not a suggestion', () => {
    expect(rotateUgcFormats(3, { preferred: 'unboxing' })).toEqual([
      'unboxing',
      'unboxing',
      'unboxing'
    ]);
  });

  it('leads with the formats native to the chosen platform', () => {
    const plan = rotateUgcFormats(4, { platform: 'youtube_shorts' });
    const native = UGC_PLATFORMS.find((p) => p.id === 'youtube_shorts')!.formats;
    for (const f of plan) expect(native).toContain(f);
  });

  it('is empty for a zero-length batch', () => {
    expect(rotateUgcFormats(0)).toEqual([]);
  });
});

describe('platformClipSeconds', () => {
  it('never exceeds the model cap', () => {
    expect(platformClipSeconds('youtube_shorts', 15)).toBe(15);
    expect(platformClipSeconds('tiktok', 22)).toBe(15);
  });

  it('falls back to the cap when no platform is chosen', () => {
    expect(platformClipSeconds(null, 22)).toBe(22);
  });
});

describe('batchSizeForKeepers', () => {
  it('renders enough to survive the expected rejection rate', () => {
    expect(batchSizeForKeepers(10)).toBe(15);
    expect(batchSizeForKeepers(10, 0.2)).toBe(13);
    expect(batchSizeForKeepers(0)).toBe(0);
  });
});

describe('prompt blocks', () => {
  it('names every format and warns against a single-format batch', () => {
    const brief = ugcFormatBrief();
    for (const id of UGC_FORMAT_IDS) expect(brief).toContain(id);
    expect(brief).toMatch(/parafrasi/i);
  });

  it('marks the formats that are not native to the chosen platform', () => {
    const brief = ugcFormatBrief({ platform: 'youtube_shorts' });
    expect(brief).toMatch(/tiktok_shop.*non nativo/);
  });

  it('states length, captions and hashtags for a platform, and says so when there is none', () => {
    expect(ugcPlatformBrief('tiktok')).toMatch(/15-30s/);
    expect(ugcPlatformBrief('facebook_reels')).toMatch(/obbligatori/);
    expect(ugcPlatformBrief(null)).toMatch(/non specificata/i);
  });
});
