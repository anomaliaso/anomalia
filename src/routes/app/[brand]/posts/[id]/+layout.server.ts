import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import {
  EDITOR_POST_COLS,
  decoratePosts,
  buildBusyDays,
  dayKeyOf
} from '$lib/server/post-editing';

export const load: LayoutServerLoad = async ({ parent, params, locals: { supabase } }) => {
  const parentData = await parent();
  const { brand, flags, logoUrl } = parentData;
  const tz = brand.timezone ?? 'Europe/Rome';
  const now = new Date();

  // `qc` in coda SOLO qui, non in EDITOR_POST_COLS (lista volutamente stretta): la colonna esiste
  // dalla 0051 e serve alla pagina details per mostrare la deviazione di scena del produttore
  // (qc.scene_deviation — contratto a due livelli seed→produttore).
  const { data: row } = await supabase
    .from('posts')
    .select(`${EDITOR_POST_COLS}, qc`)
    .eq('id', params.id)
    .eq('brand_id', brand.id)
    .maybeSingle();

  if (!row) throw error(404, 'Post not found');

  const [decorated] = decoratePosts([row], tz, now);
  const post = decorated;

  // Busy days for the schedule picker — light window around the post's date.
  const center = new Date(post.whenISO);
  const qStart = new Date(center.getTime() - 45 * 864e5).toISOString();
  const qEnd = new Date(center.getTime() + 45 * 864e5).toISOString();
  const [{ data: nearby }, { data: accts }] = await Promise.all([
    supabase
      .from('posts')
      .select('scheduled_for, slot, status')
      .eq('brand_id', brand.id)
      .or(
        `and(scheduled_for.gte.${qStart},scheduled_for.lte.${qEnd}),status.eq.pending_user`
      ),
    supabase
      .from('social_accounts')
      .select('platform')
      .eq('brand_id', brand.id)
      .eq('status', 'active')
  ]);

  const busyDays = buildBusyDays(decoratePosts(nearby ?? [], tz, now));

  const connectedPlatforms = Array.from(
    new Set((accts ?? []).map((a) => String(a.platform).toLowerCase()).filter(Boolean))
  );

  return {
    post,
    busyDays,
    connectedPlatforms,
    todayKey: dayKeyOf(now.toISOString(), tz),
    nowISO: now.toISOString(),
    brandAvatar: (logoUrl as string | null) ?? null,
    flags: flags ?? { studio: false }
  };
};
