import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * The owner's oldest organization. A user may own several (production does), so "their org"
 * has to mean one specific row, always the same one — otherwise a new brand lands in whichever
 * org the database happened to return, and with billing at org level that is the difference
 * between a paid org and an unpaid one. `id` breaks a tie on identical timestamps.
 */
async function oldestOrgId(supabase: SupabaseClient, ownerId: string): Promise<string | null> {
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// Every user gets an organization (their workspace) lazily on first need.
// Brands hang off an org, so this must run before a brand can be created.
// RLS-safe: the user owns the org they insert (owner_id = auth.uid()).
export async function ensureOrgForUser(supabase: SupabaseClient, user: User): Promise<string | null> {
  const existing = await oldestOrgId(supabase, user.id);
  if (existing) return existing;

  const handle = user.email?.split('@')[0] ?? 'My';
  const { data: org, error } = await supabase
    .from('organizations')
    .insert({ name: `${handle}'s workspace`, owner_id: user.id })
    .select('id')
    .single();
  if (error || !org) return null;

  await supabase.from('org_members').insert({ org_id: org.id, user_id: user.id, role: 'owner' });

  // A concurrent first call may have inserted its own row a moment earlier: both answers
  // converge on the oldest, so two tabs cannot walk away with two different orgs.
  return (await oldestOrgId(supabase, user.id)) ?? org.id;
}
