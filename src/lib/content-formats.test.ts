import { describe, it, expect } from 'vitest';
import { CONTENT_FORMATS, isContentFormat, normalizeContentFormat, mediaForFormat, isVideoUrl, isImageUrl, isReviewableMediaUrl, mediaUrlLabel } from './content-formats';

describe('normalizeContentFormat', () => {
  it('passes canonical enum values through untouched', () => {
    for (const f of CONTENT_FORMATS) expect(normalizeContentFormat(f)).toBe(f);
  });

  // Every DISTINCT legacy value actually present in the DB (posts.format +
  // content_plans.seeds[].format, checked 2026-07) must map explicitly.
  it('maps every legacy DB value onto the enum', () => {
    expect(normalizeContentFormat(null)).toBe('single_image');
    expect(normalizeContentFormat('post')).toBe('single_image');
    expect(normalizeContentFormat('image')).toBe('single_image');
    expect(normalizeContentFormat('story')).toBe('single_image'); // not producible → safe default
    expect(normalizeContentFormat('carousel')).toBe('carousel');
    expect(normalizeContentFormat('reel')).toBe('video');
    expect(normalizeContentFormat('short')).toBe('video');
    expect(normalizeContentFormat('short video')).toBe('video');
    expect(normalizeContentFormat('video')).toBe('video');
  });

  it('tolerates case, whitespace and free-form phrasing', () => {
    expect(normalizeContentFormat(' Reel ')).toBe('video');
    expect(normalizeContentFormat('Carousel post')).toBe('carousel');
    expect(normalizeContentFormat('Instagram Reels')).toBe('video');
    expect(normalizeContentFormat('text post')).toBe('text_post');
    expect(normalizeContentFormat('link post')).toBe('link_post');
  });

  it('never crashes and never passes through an unknown value', () => {
    for (const v of [undefined, '', '   ', 'stories', 'photo', 'meme', 42, {}, [], 'linkedin post']) {
      const out = normalizeContentFormat(v);
      expect(CONTENT_FORMATS).toContain(out);
    }
    // 'linkedin post' must NOT fuzzy-match link_post ('link' needs a word boundary).
    expect(normalizeContentFormat('linkedin post')).toBe('single_image');
    expect(normalizeContentFormat('unknown-garbage')).toBe('single_image');
  });
});

describe('isContentFormat', () => {
  it('accepts only canonical values', () => {
    expect(isContentFormat('carousel')).toBe(true);
    expect(isContentFormat('reel')).toBe(false);
    expect(isContentFormat(null)).toBe(false);
  });
});

describe('mediaForFormat', () => {
  it('binds each format to its delivery channel', () => {
    expect(mediaForFormat('single_image')).toBe('image');
    expect(mediaForFormat('carousel')).toBe('image');
    // A reel declares itself a reel. Mapping it to 'image' made the capability clamp treat it as
    // non-visual and downgrade it on exactly the platforms where video matters most.
    expect(mediaForFormat('video')).toBe('video');
    expect(mediaForFormat('text_post')).toBe('text');
    expect(mediaForFormat('link_post')).toBe('link');
  });
});

describe('isVideoUrl', () => {
  it('detects the clip extensions the pipeline actually produces/accepts', () => {
    expect(isVideoUrl('https://x.co/a/b.mp4')).toBe(true);
    expect(isVideoUrl('https://x.co/a/b.MP4')).toBe(true);
    expect(isVideoUrl('https://x.co/a/b.mov')).toBe(true);
    expect(isVideoUrl('https://x.co/a/b.webm')).toBe(true);
    expect(isVideoUrl('https://x.co/a/b.m4v')).toBe(true);
  });

  it('survives a query string — Supabase public URLs carry one', () => {
    expect(isVideoUrl('https://x.supabase.co/storage/v1/object/public/media/u/g.mp4?token=abc')).toBe(true);
  });

  it('is false for stills and for empty/absent media', () => {
    expect(isVideoUrl('https://x.co/a/b.jpg')).toBe(false);
    expect(isVideoUrl('https://x.co/a/b.webp')).toBe(false);
    expect(isVideoUrl(null)).toBe(false);
    expect(isVideoUrl(undefined)).toBe(false);
    expect(isVideoUrl('')).toBe(false);
  });

  // Guards the defensive check in renderVideo: a post that already holds a clip must never be
  // re-sent to image-to-video as its own reference image.
  it('does not match an extension merely appearing mid-path', () => {
    expect(isVideoUrl('https://x.co/mp4/cover.jpg')).toBe(false);
  });
});

describe('isImageUrl / isReviewableMediaUrl', () => {
  it('detects stills the QC worker should score', () => {
    expect(isImageUrl('https://x.co/a.png')).toBe(true);
    expect(isImageUrl('https://x.co/a.JPG?x=1')).toBe(true);
    expect(isImageUrl('https://x.co/a.webp')).toBe(true);
    expect(isImageUrl('https://x.co/a.mp4')).toBe(false);
    expect(isReviewableMediaUrl('https://x.co/a.jpg')).toBe(true);
    expect(isReviewableMediaUrl('https://x.co/a.mp4')).toBe(true);
    expect(isReviewableMediaUrl('https://x.co/a.pdf')).toBe(false);
  });
});

describe('mediaUrlLabel', () => {
  it('uses the filename and strips signed query strings', () => {
    expect(
      mediaUrlLabel('https://x.supabase.co/storage/v1/object/public/media/u/clip.mp4?token=abc')
    ).toBe('clip.mp4');
    expect(mediaUrlLabel('https://cdn.example/stills/hero.webp')).toBe('hero.webp');
  });
});
