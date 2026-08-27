import type { SupabaseClient } from '@supabase/supabase-js';

// Own post history: rows in social_post_history that were published BY THE APP (Zernio analytics
// sync) — i.e. the brand's REAL current performance.
//
// Rows with source='scrapecreators' are either posts scraped before the app existed or competitor
// data — in both cases NOT the brand's current performance as published by this app. Every
// learning point (winning patterns, history digest, engagement aggregation) must therefore read
// ONLY source='zernio', so the AI learns from the brand's real wins instead of a ~93% competitor
// mix.

export const OWN_SOURCE = 'zernio';

// Row shape mirrors what the select always returns: fields are present, possibly null.
export type OwnHistoryRow = {
  id: string;
  source: string | null;
  platform: string | null;
  platform_post_url: string | null;
  content: string | null;
  media_type: string | null;
  published_at: string | null;
  metrics: Record<string, unknown> | null;
  thumbnail_url: string | null;
};

const OWN_HISTORY_COLS =
  'id, source, platform, platform_post_url, content, media_type, published_at, metrics, thumbnail_url';

export type LoadOwnHistoryOpts = {
  /** Cap the returned rows (newest first). Default: no cap. */
  limit?: number;
  /** Only rows published within the last N days. Default: no window. */
  sinceDays?: number;
};

/** The brand's OWN published posts (source='zernio'), newest first. Empty list = no own data yet. */
export async function loadOwnPostHistory(
  supabase: SupabaseClient,
  brandId: string,
  opts: LoadOwnHistoryOpts = {}
): Promise<OwnHistoryRow[]> {
  let query = supabase
    .from('social_post_history')
    .select(OWN_HISTORY_COLS)
    .eq('brand_id', brandId)
    .eq('source', OWN_SOURCE);
  if (opts.sinceDays && opts.sinceDays > 0) {
    const since = new Date(Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('published_at', since);
  }
  query = query.order('published_at', { ascending: false });
  if (opts.limit && opts.limit > 0) query = query.limit(opts.limit);
  const { data } = await query;
  return (data ?? []) as OwnHistoryRow[];
}

/** Total count of the brand's OWN history rows (source='zernio'), across all time. */
export async function ownHistoryCount(supabase: SupabaseClient, brandId: string): Promise<number> {
  const { count } = await supabase
    .from('social_post_history')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .eq('source', OWN_SOURCE);
  return count ?? 0;
}
