import { describe, it, expect } from 'vitest';
import {
  assemblePlatformCaptions,
  captionFor,
  mediaUrlsForPublish
} from './platform-limits';
import { clampGeneratedCaptions, normalizePlatforms } from './manual-posting-captions';

const LONG = 'a'.repeat(1200);

describe('mediaUrlsForPublish', () => {
  const slides = ['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg'];

  it('sends every slide to carousel networks', () => {
    expect(mediaUrlsForPublish('instagram', slides[0], slides)).toEqual(slides);
    expect(mediaUrlsForPublish('linkedin', slides[0], slides)).toEqual(slides);
  });

  it('sends only the cover to X / Threads / TikTok', () => {
    expect(mediaUrlsForPublish('x', slides[0], slides)).toEqual([slides[0]]);
    expect(mediaUrlsForPublish('threads', null, slides)).toEqual([slides[0]]);
    expect(mediaUrlsForPublish('tiktok', slides[0], slides)).toEqual([slides[0]]);
  });

  it('falls back to the single media_url', () => {
    expect(mediaUrlsForPublish('instagram', 'https://cdn/one.jpg', null)).toEqual(['https://cdn/one.jpg']);
    expect(mediaUrlsForPublish('x', null, null)).toBeUndefined();
  });
});

describe('assemblePlatformCaptions', () => {
  it('stores only captions that differ from the main one', () => {
    const { caption, platform_captions } = assemblePlatformCaptions(
      'hello world',
      { instagram: 'hello world', x: 'hello x', linkedin: 'a longer linkedin take' },
      ['instagram', 'x', 'linkedin']
    );
    expect(caption).toBe('hello world');
    expect(platform_captions?.x).toBe('hello x');
    expect(platform_captions?.linkedin).toBe('a longer linkedin take');
    expect(platform_captions?.instagram).toBeUndefined();
  });

  it('fills X/Threads cuts when the main caption overflows', () => {
    const { platform_captions } = assemblePlatformCaptions(LONG, {}, ['instagram', 'x', 'threads']);
    expect(platform_captions?.x?.length).toBeLessThanOrEqual(280);
    expect(platform_captions?.threads?.length).toBeLessThanOrEqual(500);
    expect(captionFor(LONG, platform_captions, 'instagram')).toBe(LONG);
  });
});

describe('normalizePlatforms / clampGeneratedCaptions', () => {
  it('dedupes, lowercases, and maps twitter → x', () => {
    expect(normalizePlatforms(['Instagram', 'twitter', 'x', 'nope'])).toEqual(['instagram', 'x']);
  });

  it('accepts youtube as a publish target', () => {
    expect(normalizePlatforms(['youtube', 'YouTube', 'nope'])).toEqual(['youtube']);
  });

  it('clamps short-network captions to their limits', () => {
    const out = clampGeneratedCaptions(
      { caption: LONG, x: 'b'.repeat(400), threads: 'ok threads', instagram: LONG },
      ['instagram', 'x', 'threads']
    );
    expect(out.captions.x.length).toBeLessThanOrEqual(280);
    expect(out.captions.threads).toBe('ok threads');
    expect(out.caption.length).toBeGreaterThan(500);
  });
});
