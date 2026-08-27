import { styleAssetUrl } from '$lib/design/presets';

export type WorkbenchMode = 'media' | 'ugc';

export type AspectRatio = '1:1' | '4:5' | '9:16' | '16:9';
export type MediaKindPreference = 'auto' | 'image' | 'video';

export type GridItem = {
  id: string;
  type: 'image' | 'video';
  url: string;
  prompt: string;
  createdAt: number;
  /** Rough masonry span hint from aspect (portrait). */
  tall?: boolean;
  /** Landscape — full-width row on mobile. */
  wide?: boolean;
};

export type PromptHistoryEntry = {
  id: string;
  prompt: string;
  at: number;
  kind: MediaKindPreference;
  aspect: AspectRatio;
  mediaCount: number;
};

export const ASPECTS: AspectRatio[] = ['1:1', '4:5', '9:16', '16:9'];
export const KINDS: MediaKindPreference[] = ['auto', 'image', 'video'];
export const VARIANTS = [1, 2, 3, 4] as const;
export type VariantsCount = (typeof VARIANTS)[number];
export const UGC_VIDEO_COUNTS = Array.from({ length: 20 }, (_, i) => i + 1);
export const MAX_UPLOADS = 4;
export const MAX_ENTITY_PICKS = 3;
export const MAX_UGC_PRODUCT_PICKS = 10;
export const MAX_UGC_MODEL_PICKS = 10;
export const MAX_SEEDANCE_REFS = 10;
export const MAX_SEEDANCE_ASSET_BYTES = 40 * 1024 * 1024;

export type SeedanceAsset = { url: string; name: string };

export type EntityPick = {
  kind: 'talent' | 'person' | 'product' | 'thumb' | 'brand' | 'style';
  id: string;
  url: string;
  urls: string[];
  label?: string;
};

export type PickerKind = 'talents' | 'people' | 'products' | 'thumbs' | 'styles';
export type PickerAnchor = 'plus' | 'banner';

export type ComposerMenu =
  | 'none'
  | 'aspect'
  | 'kind'
  | 'variants'
  | 'videoCount'
  | 'plus'
  | 'picker'
  | 'model'
  | 'ugcFormat'
  | 'ugcPlatform';

export type MediaRefsPayload = {
  brandImages: { id: string; url: string }[];
  postThumbs: { id: string; url: string }[];
  people: { id: string; name: string; role: string | null; url: string; urls: string[] }[];
  talents: { id: string; slug: string; name: string; url: string; urls: string[] }[];
  products: { id: string; name: string; url: string; urls: string[] }[];
};

export function isUsableMediaUrl(url: string | null | undefined): boolean {
  const u = String(url ?? '').trim();
  return /^https?:\/\//i.test(u) || u.startsWith('data:image/') || u.startsWith('data:video/');
}

export function parseUrlLines(text: string, max: number): string[] {
  return text
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s))
    .slice(0, max);
}

export function layoutFromAspect(a: AspectRatio, type: 'image' | 'video' = 'image') {
  const wide = a === '16:9';
  // Portrait / near-portrait share a 2-up mobile cell; square stays 2-up too.
  const tall = !wide && (a === '9:16' || a === '4:5' || (type === 'video' && a !== '1:1'));
  return { tall, wide };
}

export function mapServerItems(
  rows: Array<{
    id: string;
    kind: string;
    url: string;
    prompt: string;
    aspect?: string | null;
    created_at: string;
  }>
): GridItem[] {
  return rows
    .filter((r) => isUsableMediaUrl(r.url))
    .map((r) => {
      const type: GridItem['type'] = r.kind === 'video' ? 'video' : 'image';
      const aspect = (ASPECTS.includes(r.aspect as AspectRatio) ? r.aspect : '4:5') as AspectRatio;
      const layout = layoutFromAspect(aspect, type);
      return {
        id: r.id,
        type,
        url: String(r.url).trim(),
        prompt: r.prompt ?? '',
        createdAt: new Date(r.created_at).getTime(),
        tall: layout.tall,
        wide: layout.wide
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export function mergeItemsByNewest(existing: GridItem[], incoming: GridItem[]): GridItem[] {
  const byId = new Map<string, GridItem>();
  for (const row of [...incoming, ...existing]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export function mapServerPrompts(
  rows: Array<{
    id: string;
    prompt: string;
    kind: string;
    aspect: string | null;
    media_count: number;
    created_at: string;
  }>
): PromptHistoryEntry[] {
  return rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    at: new Date(r.created_at).getTime(),
    kind: (KINDS.includes(r.kind as MediaKindPreference) ? r.kind : 'auto') as MediaKindPreference,
    aspect: (ASPECTS.includes(r.aspect as AspectRatio) ? r.aspect : '4:5') as AspectRatio,
    mediaCount: r.media_count ?? 0
  }));
}

export function extractMediaFromOutput(
  output: unknown
): Array<{ type: 'image' | 'video'; url: string; prompt: string; id?: string }> {
  if (!output || typeof output !== 'object') return [];
  const o = output as Record<string, unknown>;
  const out: Array<{ type: 'image' | 'video'; url: string; prompt: string; id?: string }> = [];

  if (
    o.ok &&
    (o.type === 'image' || o.type === 'video') &&
    typeof o.url === 'string' &&
    isUsableMediaUrl(o.url)
  ) {
    out.push({
      type: o.type,
      url: o.url.trim(),
      prompt: typeof o.prompt === 'string' ? o.prompt : '',
      id: typeof o.id === 'string' ? o.id : undefined
    });
  }
  if (Array.isArray(o.media)) {
    for (const m of o.media) {
      if (!m || typeof m !== 'object') continue;
      const row = m as Record<string, unknown>;
      if (
        (row.type === 'image' || row.type === 'video') &&
        typeof row.url === 'string' &&
        isUsableMediaUrl(row.url)
      ) {
        out.push({
          type: row.type,
          url: row.url.trim(),
          prompt: typeof row.prompt === 'string' ? row.prompt : '',
          id: typeof row.id === 'string' ? row.id : undefined
        });
      }
    }
  }
  return out;
}

export function stylePickUrl(slug: string) {
  const path = styleAssetUrl(slug, 'cover', 720);
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${path}`;
  }
  return path;
}
