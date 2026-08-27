import { findPreset, isPresetSlide, isStoryVariant } from '$lib/design/presets';
import { clampPresetThumbWidth } from '$lib/design/presets/urls';
import { renderPresetSlide, renderPresetStory } from '$lib/server/preset-render';
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';

/**
 * One slide (3:4) or story variant (story-a|b|c → 9:16) of a preset.
 * `?w=360|540|720|1080` → downscaled WebP for the library grid; omit for full PNG.
 */
export const GET: RequestHandler = async ({ params, url, fetch, setHeaders }) => {
  const preset = findPreset(params.slug);
  if (!preset) error(404, 'Style not found');

  const kind = params.kind;
  const outWidth = clampPresetThumbWidth(url.searchParams.get('w'));
  const storyMatch = /^story-([abc])$/.exec(kind);
  let result: Awaited<ReturnType<typeof renderPresetSlide>>;

  if (storyMatch) {
    const variant = storyMatch[1];
    if (!isStoryVariant(variant)) error(404, 'Story not found');
    result = await renderPresetStory(preset, variant, fetch, outWidth);
  } else if (isPresetSlide(kind)) {
    result = await renderPresetSlide(preset, kind, fetch, outWidth);
  } else {
    error(404, 'Slide not found');
  }

  setHeaders({
    'content-type': result.contentType,
    // Vary on w so CDN doesn't mix full PNG with thumbs.
    vary: 'Accept',
    'cache-control': 'public, max-age=3600, s-maxage=31536000, stale-while-revalidate=86400'
  });
  return new Response(new Uint8Array(result.body));
};
