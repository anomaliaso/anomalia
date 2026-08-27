import { describe, expect, it } from 'vitest';
import { annotatePostMedia, isVideoPostRow, resolvePostVideoCover, stillCoverUrl } from '$lib/server/media-origin';
import type { GraphicVersion } from '$lib/server/design-store';
import type { Graphic } from '$lib/design/blocks';

const sampleSpec: Graphic = {
  aspect: '4:5',
  theme: 'light',
  blocks: [
    { type: 'kicker', text: 'Tip' },
    { type: 'headline', text: 'Hello' },
    { type: 'footer', brand: 'Acme' }
  ]
};

const sampleGraphic: GraphicVersion = {
  id: 'g1',
  version: 2,
  spec: sampleSpec,
  source: null,
  sourceKind: 'html',
  aspect: '4:5',
  mediaUrl: 'https://example.com/g.png',
  brief: 'quote card',
  createdAt: '2026-01-01T00:00:00Z'
};

describe('annotatePostMedia', () => {
  it('flags typographic graphics with editable spec', () => {
    const info = annotatePostMedia(
      { content_type: 'generated_image', image_prompt: null, media_url: 'https://example.com/g.png' },
      sampleGraphic
    );
    expect(info.media_origin).toBe('typographic_graphic');
    expect(info.graphic?.spec?.blocks[1]).toEqual({ type: 'headline', text: 'Hello' });
    expect(info.graphic?.source_chars).toBeGreaterThan(0);
    expect(info.graphic).not.toHaveProperty('source');
    expect(info.media_origin_note).toMatch(/grep_source/);
    expect(info.media_origin_note).toMatch(/read_media/);
    expect(info.media_origin_note).toMatch(/use_library_image/);
    expect(info.media_origin_note).toMatch(/generate_image/);
    expect(info.media_origin_note).not.toMatch(/Do NOT call regenerate_image \/ generate_image/);
  });

  it('flags generated_graphic content_type even without a version row', () => {
    const info = annotatePostMedia(
      { content_type: 'generated_graphic', media_url: 'https://example.com/g.png' },
      null
    );
    expect(info.media_origin).toBe('typographic_graphic');
    expect(info.graphic).toBeUndefined();
  });

  it('flags user uploads', () => {
    const info = annotatePostMedia(
      { content_type: 'uploaded_image', media_url: 'https://example.com/u.jpg' },
      null
    );
    expect(info.media_origin).toBe('user_uploaded');
  });

  it('flags AI photos', () => {
    const info = annotatePostMedia(
      {
        content_type: 'generated_image',
        image_prompt: 'a coffee cup',
        media_url: 'https://example.com/ai.png'
      },
      null
    );
    expect(info.media_origin).toBe('ai_generated');
  });

  it('flags missing media', () => {
    const info = annotatePostMedia({ content_type: 'text', media_url: null }, null);
    expect(info.media_origin).toBe('none');
  });

  it('flags generated video posts', () => {
    const info = annotatePostMedia(
      {
        content_type: 'generated_video',
        format: 'video',
        media_url: 'https://example.com/clip.mp4',
        video_thumbnail_url: 'https://example.com/cover.jpg'
      },
      null
    );
    expect(info.media_origin).toBe('video');
    expect(info.media_origin_note).toMatch(/make_video/);
    expect(info.media_origin_note).toMatch(/NEVER call design_graphic/);
  });

  it('keeps a reel classified as video even if a leftover graphic_designs row exists', () => {
    const info = annotatePostMedia(
      {
        content_type: 'generated_video',
        format: 'video',
        media_url: 'https://example.com/clip.mp4'
      },
      sampleGraphic
    );
    expect(info.media_origin).toBe('video');
    expect(info.graphic).toBeUndefined();
  });
});

describe('isVideoPostRow / resolvePostVideoCover', () => {
  it('treats mp4 media_url as video even without content_type', () => {
    expect(isVideoPostRow({ media_url: 'https://x.co/a.mp4' })).toBe(true);
    expect(isVideoPostRow({ content_type: 'generated_image', media_url: 'https://x.co/a.jpg' })).toBe(
      false
    );
  });

  it('never returns the mp4 as an I2V cover', () => {
    expect(
      resolvePostVideoCover({
        media_url: 'https://x.co/clip.mp4',
        video_thumbnail_url: 'https://x.co/cover.jpg'
      })
    ).toBe('https://x.co/cover.jpg');
    expect(resolvePostVideoCover({ media_url: 'https://x.co/clip.mp4', video_thumbnail_url: null })).toBe(
      null
    );
    expect(stillCoverUrl('https://x.co/clip.mp4')).toBeNull();
    expect(stillCoverUrl('https://x.co/cover.webp')).toBe('https://x.co/cover.webp');
  });
});
