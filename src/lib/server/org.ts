import type { SupabaseClient, User } from '@supabase/supabase-js';

// Every user gets one organization (their workspace) lazily on first need.
// Brands hang off an org, so this must run before a brand can be created.
// RLS-safe: the user owns the org they insert (owner_id = auth.uid()).
export async function ensureOrgForUser(supabase: SupabaseClient, user: User): Promise<string | null> {
  const { data: existing } = await supabase
    .from('organizations')
    .select('id')
    .eq('owner_id', user.id)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const handle = user.email?.split('@')[0] ?? 'My';
  const { data: org, error } = await supabase
    .from('organizations')
    .insert({ name: `${handle}'s workspace`, owner_id: user.id })
    .select('id')
    .single();
  if (error || !org) return null;

  await supabase.from('org_members').insert({ org_id: org.id, user_id: user.id, role: 'owner' });
  return org.id;
}
