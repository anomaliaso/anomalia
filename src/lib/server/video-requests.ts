import type { SupabaseClient } from '@supabase/supabase-js';
import { founderVideoQuota } from '$lib/server/plans';
import { monthKey } from '$lib/server/usage';

// Founder-made video commissions: the user files a request (brief + optional reference images),
// the Anomalia team fulfils it from the admin dashboard and delivers the clip in-app. This module is
// the USER side (quota + create + list); fulfilment lives in /admin/videos under the
// service-role client.

export type VideoRequestRow = {
  id: string;
  platform: string | null;
  brief: string;
  status: 'requested' | 'in_progress' | 'delivered' | 'rejected';
  admin_note: string | null;
  delivered_post_id: string | null;
  created_at: string;
  delivered_at: string | null;
};

export type FounderVideoBudget = { used: number; quota: number; remaining: number };

// Monthly commission budget for a brand: quota by plan tier minus this month's requests.
// Rejected requests give the slot back — the team declined, the user shouldn't lose it.
export async function founderVideoBudget(
  supabase: SupabaseClient,
  brandId: string,
  plan: string | null | undefined,
  tz: string
): Promise<FounderVideoBudget> {
  const quota = founderVideoQuota(plan);
  if (quota <= 0) return { used: 0, quota: 0, remaining: 0 };
  const { count } = await supabase
    .from('video_requests')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .eq('month_key', monthKey(tz))
    .neq('status', 'rejected');
  const used = count ?? 0;
  return { used, quota, remaining: Math.max(0, quota - used) };
}

export async function createVideoRequest(
  supabase: SupabaseClient,
  opts: { brandId: string; userId: string; tz: string; platform: string; brief: string; referenceUrls: string[] }
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from('video_requests')
    .insert({
      brand_id: opts.brandId,
      requested_by: opts.userId,
      platform: opts.platform || null,
      brief: opts.brief,
      reference_urls: opts.referenceUrls.length ? opts.referenceUrls : null,
      month_key: monthKey(opts.tz)
    })
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'insert_failed' };
  return { id: data.id as string };
}

// The brand's recent requests for the Content-page panel (newest first).
export async function listVideoRequests(supabase: SupabaseClient, brandId: string, limit = 10): Promise<VideoRequestRow[]> {
  const { data } = await supabase
    .from('video_requests')
    .select('id, platform, brief, status, admin_note, delivered_post_id, created_at, delivered_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as VideoRequestRow[];
}
