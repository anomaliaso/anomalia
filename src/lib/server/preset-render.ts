import {
  PRESET_HEIGHT,
  PRESET_WIDTH,
  STORY_HEIGHT,
  STORY_WIDTH,
  presetTree,
  storyTree,
  type PresetPhotos,
  type PresetSlide,
  type StoryVariant,
  type StylePreset
} from '$lib/design/presets';
import { loadGraphicFont } from '$lib/server/design-render';
import {
  clampPresetThumbWidth,
  styleAssetUrl,
  type PresetThumbWidth
} from '$lib/design/presets/urls';

export { clampPresetThumbWidth, styleAssetUrl, type PresetThumbWidth };
export { PRESET_THUMB_WIDTHS } from '$lib/design/presets/urls';

/**
 * Rasterise one slide (3:4) or story variant (9:16) of a style preset.
 * Optional downscale via sharp for fast library thumbs (WebP).
 */

export type PresetRenderResult = {
  body: Buffer;
  contentType: 'image/png' | 'image/webp';
};

export async function loadPresetPhotos(fetcher: typeof fetch): Promise<PresetPhotos> {
  const load = async (name: string) => {
    const res = await fetcher(`/styles/${name}.jpg`);
    if (!res.ok) throw new Error(`preset photo ${name}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  };
  const [a, b, c] = await Promise.all([load('scene-a'), load('scene-b'), load('scene-c')]);
  return { a, b, c };
}

async function rasterise(
  tree: unknown,
  width: number,
  height: number,
  families: string[],
  outWidth?: PresetThumbWidth
): Promise<PresetRenderResult> {
  const loaded = await Promise.all(families.map((f) => loadGraphicFont(f)));
  const fonts = loaded.flatMap((l) => l.fonts);

  const [{ default: satori }, { Resvg }] = await Promise.all([
    import('satori'),
    import(/* @vite-ignore */ '@resvg/resvg-js')
  ]);

  const svg = await satori(tree as never, {
    width,
    height,
    fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight as never, style: 'normal' as const }))
  });

  const full = Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());

  // Full asset: lightly compress PNG. Thumb: downscale → WebP for the grid.
  const sharp = (await import('sharp')).default;
  if (outWidth && outWidth < width) {
    const body = await sharp(full)
      .resize(outWidth, Math.round((outWidth * height) / width), { fit: 'fill' })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
    return { body, contentType: 'image/webp' };
  }

  const body = await sharp(full).png({ compressionLevel: 8, palette: false }).toBuffer();
  return { body, contentType: 'image/png' };
}

export async function renderPresetSlide(
  preset: StylePreset,
  kind: PresetSlide,
  fetcher: typeof fetch,
  outWidth?: PresetThumbWidth
): Promise<PresetRenderResult> {
  const photos = await loadPresetPhotos(fetcher);
  const families = [...new Set([preset.fonts.display, preset.fonts.body, preset.fonts.mono])];
  return rasterise(presetTree(preset, kind, photos), PRESET_WIDTH, PRESET_HEIGHT, families, outWidth);
}

export async function renderPresetStory(
  preset: StylePreset,
  variant: StoryVariant,
  fetcher: typeof fetch,
  outWidth?: PresetThumbWidth
): Promise<PresetRenderResult> {
  const photos = await loadPresetPhotos(fetcher);
  const families = [...new Set([preset.fonts.display, preset.fonts.body, preset.fonts.mono])];
  return rasterise(storyTree(preset, variant, photos), STORY_WIDTH, STORY_HEIGHT, families, outWidth);
}
