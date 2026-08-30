import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';

export type MediaGeneratorItemRow = {
  id: string;
  brand_id: string;
  user_id: string;
  prompt_id: string | null;
  kind: 'image' | 'video';
  url: string;
  prompt: string;
  aspect: string | null;
  ugc: boolean;
  created_at: string;
};

export type MediaGeneratorPromptRow = {
  id: string;
  brand_id: string;
  user_id: string;
  prompt: string;
  kind: string;
  aspect: string | null;
  use_brand_style: boolean;
  ugc: boolean;
  media_count: number;
  created_at: string;
};

export async function insertMediaGeneratorPrompt(
  supabase: SupabaseClient,
  input: {
    brandId: string;
    userId: string;
    prompt: string;
    kind: string;
    aspect?: string | null;
    useBrandStyle?: boolean;
    ugc?: boolean;
  }
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from('media_generator_prompts')
    .insert({
      brand_id: input.brandId,
      user_id: input.userId,
      prompt: input.prompt.slice(0, 8000),
      kind: input.kind || 'auto',
      aspect: input.aspect ?? null,
      use_brand_style: input.useBrandStyle !== false,
      ugc: input.ugc === true,
      media_count: 0
    })
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'insert failed' };
  return { id: data.id as string };
}

export async function bumpMediaGeneratorPromptCount(
  supabase: SupabaseClient,
  promptId: string,
  by = 1
): Promise<void> {
  const { data } = await supabase
    .from('media_generator_prompts')
    .select('media_count')
    .eq('id', promptId)
    .maybeSingle();
  const next = Math.max(0, Number(data?.media_count ?? 0) + by);
  await supabase.from('media_generator_prompts').update({ media_count: next }).eq('id', promptId);
}

export async function insertMediaGeneratorItem(
  supabase: SupabaseClient,
  input: {
    brandId: string;
    userId: string;
    promptId?: string | null;
    kind: 'image' | 'video';
    url: string;
    prompt: string;
    aspect?: string | null;
    ugc?: boolean;
  }
): Promise<{ row: MediaGeneratorItemRow } | { error: string }> {
  const url = String(input.url ?? '').trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return { error: 'invalid media url' };
  }
  const { data, error } = await supabase
    .from('media_generator_items')
    .insert({
      brand_id: input.brandId,
      user_id: input.userId,
      prompt_id: input.promptId ?? null,
      kind: input.kind,
      url,
      prompt: input.prompt.slice(0, 8000),
      aspect: input.aspect ?? null,
      ugc: input.ugc === true
    })
    .select('*')
    .single();
  if (error || !data) return { error: error?.message ?? 'insert failed' };
  if (input.promptId) {
    await bumpMediaGeneratorPromptCount(supabase, input.promptId, 1).catch(swallow('bump prompt usage'));
  }
  return { row: data as MediaGeneratorItemRow };
}

/**
 * L'EDIT di una grafica aggiorna la SUA tessera.
 *
 * `design_graphic` con `editItemId` salvava storage e riga di versione ma nessuno aggiornava
 * `media_generator_items.url`: la griglia continuava a mostrare l'immagine vecchia e l'edit
 * sembrava non essere mai successo. Solo `url` (e il prompt più recente): la storia completa vive
 * nelle righe di versione di design-store, la tessera mostra l'ultima.
 */
export async function updateMediaGeneratorItemUrl(
  supabase: SupabaseClient,
  input: { brandId: string; itemId: string; url: string; prompt?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = String(input.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'invalid media url' };
  const { error } = await supabase
    .from('media_generator_items')
    .update({ url, ...(input.prompt ? { prompt: input.prompt.slice(0, 8000) } : {}) })
    .eq('brand_id', input.brandId)
    .eq('id', input.itemId);
  if (error) {
    console.error('[media-generator] update item url', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function deleteMediaGeneratorItem(
  supabase: SupabaseClient,
  brandId: string,
  itemId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('media_generator_items')
    .delete()
    .eq('brand_id', brandId)
    .eq('id', itemId);
  if (error) {
    console.error('[media-generator] delete item', error.message);
    return false;
  }
  return true;
}

export const MEDIA_GENERATOR_PAGE_SIZE = 24;

export type ListMediaGeneratorItemsOpts = {
  /** Page size (capped). Default {@link MEDIA_GENERATOR_PAGE_SIZE}. */
  limit?: number;
  /**
   * Cursor: only rows strictly older than this ISO timestamp (newest-first pages).
   * Pass the oldest already-loaded item's `created_at`.
   */
  before?: string;
  /** When true, only UGC talking videos (UGC Creator grid). */
  ugcOnly?: boolean;
};

export type ListMediaGeneratorItemsResult = {
  items: MediaGeneratorItemRow[];
  hasMore: boolean;
};

/**
 * Newest first (`created_at desc`, then `id desc`). Use `before` for
 * infinite-scroll pages after the initial SSR load.
 */
export async function listMediaGeneratorItems(
  supabase: SupabaseClient,
  brandId: string,
  opts?: ListMediaGeneratorItemsOpts
): Promise<ListMediaGeneratorItemsResult> {
  const limit = Math.min(Math.max(opts?.limit ?? MEDIA_GENERATOR_PAGE_SIZE, 1), 60);
  const before = typeof opts?.before === 'string' ? opts.before.trim() : '';

  let query = supabase
    .from('media_generator_items')
    .select('*')
    .eq('brand_id', brandId)
    .not('url', 'is', null)
    .neq('url', '')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (opts?.ugcOnly) {
    query = query.eq('ugc', true).eq('kind', 'video');
  }

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[media-generator] list items', error.message);
    return { items: [], hasMore: false };
  }

  const rows = ((data ?? []) as MediaGeneratorItemRow[]).filter((row) =>
    /^https?:\/\//i.test(String(row.url ?? '').trim())
  );
  const hasMore = rows.length > limit;
  return { items: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

export async function listMediaGeneratorPrompts(
  supabase: SupabaseClient,
  brandId: string,
  opts?: { limit?: number; ugcOnly?: boolean }
): Promise<MediaGeneratorPromptRow[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 80, 1), 200);
  let query = supabase
    .from('media_generator_prompts')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts?.ugcOnly) {
    query = query.eq('ugc', true);
  } else {
    query = query.eq('ugc', false);
  }
  const { data, error } = await query;
  if (error) {
    console.error('[media-generator] list prompts', error.message);
    return [];
  }
  return (data ?? []) as MediaGeneratorPromptRow[];
}
