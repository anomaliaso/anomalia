import { describe, expect, it } from 'vitest';
import {
  DESIGN_GRAPHIC_ON_VIDEO_MESSAGE,
  MAKE_VIDEO_NO_SOURCE_MESSAGE,
  designGraphicVideoBlock,
  resolveMakeVideoSource
} from './post-editor-video';

const VIDEO_ROW = {
  content_type: 'generated_video',
  format: 'video',
  media_url: 'https://cdn.example/clip.mp4',
  video_thumbnail_url: 'https://cdn.example/cover.jpg',
  image_prompt: 'talking head in a kitchen'
};

describe('designGraphicVideoBlock', () => {
  it('blocks design_graphic on a reel', () => {
    const blocked = designGraphicVideoBlock(VIDEO_ROW);
    expect(blocked?.error).toBe('is_video');
    expect(blocked?.action).toBe('make_video');
    expect(blocked?.message).toBe(DESIGN_GRAPHIC_ON_VIDEO_MESSAGE);
  });

  it('allows conversion only with convert_from_video', () => {
    expect(designGraphicVideoBlock(VIDEO_ROW, true)).toBeNull();
  });

  it('does not block a photo post', () => {
    expect(
      designGraphicVideoBlock({
        content_type: 'generated_image',
        media_url: 'https://cdn.example/still.jpg'
      })
    ).toBeNull();
  });
});

describe('resolveMakeVideoSource', () => {
  it('remakes an existing reel from the stored cover still, not the mp4', () => {
    const src = resolveMakeVideoSource(VIDEO_ROW, {
      script: 'Gestire decine di bozze ogni giorno ti fa perdere tempo.',
      ugc: true
    });
    expect(src.ok).toBe(true);
    if (!src.ok) return;
    expect(src.remake).toBe(true);
    expect(src.cover).toBe('https://cdn.example/cover.jpg');
    expect(src.referenceVideoUrl).toBeNull();
    expect(src.imagePrompt).toBe('talking head in a kitchen');
  });

  it('falls back to the existing mp4 as a reference when no cover still was stored', () => {
    const src = resolveMakeVideoSource(
      { ...VIDEO_ROW, video_thumbnail_url: null },
      { script: 'Ciao, prova questo.', ugc: true }
    );
    expect(src.ok).toBe(true);
    if (!src.ok) return;
    expect(src.cover).toBeNull();
    expect(src.referenceVideoUrl).toBe('https://cdn.example/clip.mp4');
  });

  it('does not treat the mp4 as a cover even if video_thumbnail_url is also an mp4', () => {
    const src = resolveMakeVideoSource({
      ...VIDEO_ROW,
      video_thumbnail_url: 'https://cdn.example/also.mp4'
    });
    expect(src.ok).toBe(true);
    if (!src.ok) return;
    expect(src.cover).toBeNull();
    expect(src.referenceVideoUrl).toBe('https://cdn.example/clip.mp4');
  });

  it('animates a photo post from media_url', () => {
    const src = resolveMakeVideoSource({
      content_type: 'generated_image',
      media_url: 'https://cdn.example/still.png',
      image_prompt: 'a founder at a desk'
    });
    expect(src.ok).toBe(true);
    if (!src.ok) return;
    expect(src.remake).toBe(false);
    expect(src.cover).toBe('https://cdn.example/still.png');
    expect(src.referenceVideoUrl).toBeNull();
  });

  it('skips a mistaken blank graphic cover when the user asked for talking UGC', () => {
    const src = resolveMakeVideoSource(
      {
        content_type: 'generated_graphic',
        media_url: 'https://cdn.example/blank-graphic.png',
        image_prompt: null
      },
      {
        script: 'Gestire decine di bozze ogni giorno ti fa perdere tantissimo tempo.',
        ugc: true,
        prompt: 'natural talking UGC, no on-screen text'
      }
    );
    expect(src.ok).toBe(true);
    if (!src.ok) return;
    expect(src.remake).toBe(false);
    expect(src.cover).toBeNull();
    expect(src.imagePrompt).toContain('natural talking UGC');
  });

  it('refuses when there is nothing to drive a clip — and does not suggest design_graphic', () => {
    const src = resolveMakeVideoSource({
      content_type: 'generated_image',
      media_url: null,
      image_prompt: null
    });
    expect(src).toEqual({ ok: false, error: 'no_source', message: MAKE_VIDEO_NO_SOURCE_MESSAGE });
    expect(MAKE_VIDEO_NO_SOURCE_MESSAGE).not.toMatch(/render its image first/i);
    expect(MAKE_VIDEO_NO_SOURCE_MESSAGE).toMatch(/Do NOT call design_graphic/);
  });
});
