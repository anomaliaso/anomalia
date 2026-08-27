// Shared AI talent library — global models (not brand-scoped).
// Photos live in the private `talent` storage bucket as optimized WebP.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TalentBodyType, TalentGender, TalentHeightBand } from '$lib/talent-labels';

export type { TalentBodyType, TalentGender, TalentHeightBand };
export {
  TALENT_BODY_TYPE_LABELS,
  TALENT_GENDER_LABELS,
  TALENT_GENDER_LABELS_IT,
  TALENT_GENDER_ORDER,
  TALENT_HEIGHT_BAND_LABELS,
  TALENT_HEIGHT_BAND_LABELS_IT,
  talentBodyLabel,
  talentGenderLabel,
  talentHeightLabel
} from '$lib/talent-labels';

const BUCKET = 'talent';
const SIGN_TTL_SECONDS = 60 * 60 * 6; // 6h — covers a public page browse session

/** Guest preview: 2 full rows on the 3-column grid, then the register gate. */
export const TALENT_GUEST_PREVIEW = 6;

export type TalentTraits = {
  hair?: Record<string, string>;
  eyes?: string;
  face?: string;
  skin?: string;
  body?: string;
  marks?: string;
  wardrobe?: Record<string, string>;
  [key: string]: unknown;
};

export type TalentView = {
  id: string;
  view_key: string;
  label: string;
  aspect_ratio: string | null;
  path: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  sort_order: number;
  /** Present when signed via `listTalents` / `getTalent`. */
  url?: string;
};

export type Talent = {
  id: string;
  slug: string;
  name: string;
  gender: TalentGender | null;
  age: number | null;
  body_type: TalentBodyType | null;
  height_band: TalentHeightBand | null;
  ethnicity: string | null;
  summary: string | null;
  traits: TalentTraits;
  status: string;
  views: TalentView[];
};

export type TalentListFilters = {
  gender?: TalentGender | TalentGender[];
  body_type?: TalentBodyType | TalentBodyType[];
  height_band?: TalentHeightBand | TalentHeightBand[];
  ethnicity?: string | string[];
};

async function signPaths(supabase: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const clean = paths.filter(Boolean);
  if (!clean.length) return out;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(clean, SIGN_TTL_SECONDS);
  for (const row of data ?? []) {
    if (row.signedUrl && row.path) out.set(row.path, row.signedUrl);
  }
  return out;
}

function attachUrls(views: TalentView[], map: Map<string, string>): TalentView[] {
  return views.map((v) => {
    const url = map.get(v.path);
    return url ? { ...v, url } : v;
  });
}

function asArray<T extends string>(v: T | T[] | undefined): T[] | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v : [v];
}

function mapRow(m: Record<string, unknown>, map: Map<string, string>): Talent {
  const views = ((m.talent_views ?? []) as TalentView[])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
  return {
    id: m.id as string,
    slug: m.slug as string,
    name: m.name as string,
    gender: (m.gender as TalentGender | null) ?? null,
    age: (m.age as number | null) ?? null,
    body_type: (m.body_type as TalentBodyType | null) ?? null,
    height_band: (m.height_band as TalentHeightBand | null) ?? null,
    ethnicity: (m.ethnicity as string | null) ?? null,
    summary: (m.summary as string | null) ?? null,
    traits: (m.traits ?? {}) as TalentTraits,
    status: m.status as string,
    views: attachUrls(views, map)
  };
}

const SELECT =
  'id, slug, name, gender, age, body_type, height_band, ethnicity, summary, traits, status, talent_views ( id, view_key, label, aspect_ratio, path, mime_type, width, height, bytes, sort_order )';

/** List active talents with signed view URLs (for pickers / tools). */
export async function listTalents(
  supabase: SupabaseClient,
  filters: TalentListFilters = {}
): Promise<Talent[]> {
  let q = supabase.from('talents').select(SELECT).eq('status', 'active').order('name', { ascending: true });

  const genders = asArray(filters.gender);
  if (genders?.length) q = q.in('gender', genders);
  const bodies = asArray(filters.body_type);
  if (bodies?.length) q = q.in('body_type', bodies);
  const heights = asArray(filters.height_band);
  if (heights?.length) q = q.in('height_band', heights);
  const ethnicities = asArray(filters.ethnicity);
  if (ethnicities?.length) q = q.in('ethnicity', ethnicities);

  const { data: models, error } = await q;
  if (error) throw error;
  if (!models?.length) return [];

  const flatViews = models.flatMap((m) => (m.talent_views ?? []) as TalentView[]);
  const map = await signPaths(
    supabase,
    flatViews.map((v) => v.path)
  );

  return models.map((m) => mapRow(m as Record<string, unknown>, map));
}

/** Fetch one talent by slug, with signed view URLs. */
export async function getTalent(supabase: SupabaseClient, slug: string): Promise<Talent | null> {
  const { data: m, error } = await supabase.from('talents').select(SELECT).eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!m) return null;

  const views = ((m.talent_views ?? []) as TalentView[])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
  const map = await signPaths(
    supabase,
    views.map((v) => v.path)
  );

  return mapRow(m as Record<string, unknown>, map);
}

export { BUCKET as TALENT_BUCKET };
