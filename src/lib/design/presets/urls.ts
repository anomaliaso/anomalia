/** Client-safe style asset URLs (no server deps). */

/** Widths allowed on `?w=` — keeps CDN/cache keys finite. */
export const PRESET_THUMB_WIDTHS = [360, 540, 720, 1080] as const;
export type PresetThumbWidth = (typeof PRESET_THUMB_WIDTHS)[number];

export function clampPresetThumbWidth(raw: string | null | undefined): PresetThumbWidth | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  let best: PresetThumbWidth = PRESET_THUMB_WIDTHS[0];
  let bestDist = Math.abs(n - best);
  for (const w of PRESET_THUMB_WIDTHS) {
    const d = Math.abs(n - w);
    if (d < bestDist) {
      best = w;
      bestDist = d;
    }
  }
  return best;
}

/** Library grid / gallery URL. Omit `w` for full-res PNG (OG, download). */
export function styleAssetUrl(slug: string, kind: string, w?: number): string {
  const base = `/styles/${slug}/${kind}.png`;
  return w ? `${base}?w=${w}` : base;
}

/** `srcset` for responsive thumbs (360 / 540 / 720 by default). */
export function styleAssetSrcSet(
  slug: string,
  kind: string,
  widths: readonly number[] = [360, 540, 720]
): string {
  return widths.map((w) => `${styleAssetUrl(slug, kind, w)} ${w}w`).join(', ');
}

