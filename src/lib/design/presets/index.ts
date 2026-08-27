/**
 * Style presets — the LIBRARY of looks a brand can pick from.
 */
export {
  BRAND_SLOT,
  DEMO,
  PRESET_HEIGHT,
  PRESET_SLIDES,
  PRESET_WIDTH,
  SITE_SLOT,
  STORY_HEIGHT,
  STORY_VARIANTS,
  STORY_WIDTH,
  isPresetSlide,
  isStoryVariant,
  s,
  slideIndex,
  type Bilingual,
  type El,
  type PresetFonts,
  type PresetPhotos,
  type PresetReelTokens,
  type PresetSlide,
  type StoryVariant,
  type StylePreset
} from './shared';

export { styleAssetUrl, styleAssetSrcSet, clampPresetThumbWidth, PRESET_THUMB_WIDTHS } from './urls';
export type { PresetThumbWidth } from './urls';

import { acido } from './acido';
import { aria } from './aria';
import { bruto } from './bruto';
import { cedro } from './cedro';
import { collage } from './collage';
import { editoriale } from './editoriale';
import { grana } from './grana';
import { jolt } from './jolt';
import { manifesto } from './manifesto';
import { modulo } from './modulo';
import { morbido } from './morbido';
import { mosaico } from './mosaico';
import { nastro } from './nastro';
import { pressa } from './pressa';
import { prisma } from './prisma';
import { protesta } from './protesta';
import { scheda } from './scheda';
import { shock } from './shock';
import { sistema } from './sistema';
import { strada } from './strada';
import { timbro } from './timbro';
import { tracima } from './tracima';
import { urlo } from './urlo';
import { vetrina } from './vetrina';
import { visto } from './visto';
import type { El, PresetPhotos, PresetSlide, StoryVariant, StylePreset } from './shared';

export const STYLE_PRESETS: readonly StylePreset[] = [
  editoriale,
  manifesto,
  sistema,
  vetrina,
  morbido,
  aria,
  scheda,
  urlo,
  timbro,
  nastro,
  grana,
  modulo,
  collage,
  prisma,
  visto,
  tracima,
  pressa,
  mosaico,
  cedro,
  acido,
  shock,
  jolt,
  strada,
  protesta,
  bruto
];

export function findPreset(slug: string): StylePreset | undefined {
  return STYLE_PRESETS.find((p) => p.slug === slug);
}

export function presetTree(preset: StylePreset, kind: PresetSlide, photos: PresetPhotos): El {
  return preset.build(kind, preset.fonts, photos);
}

export function storyTree(preset: StylePreset, variant: StoryVariant, photos: PresetPhotos): El {
  return preset.stories[variant](preset.fonts, photos);
}
