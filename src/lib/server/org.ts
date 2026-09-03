import type { SupabaseClient, User } from '@supabase/supabase-js';

export const OWNER_CONSTRAINT = 'organizations_owner_id_key';

function violatesOwnerConstraint(error: { message?: string; details?: string } | null): boolean {
  if (!error) return false;
  return `${error.message ?? ''} ${error.details ?? ''}`.includes(OWNER_CONSTRAINT);
}

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

  if (!error) {
    await supabase.from('org_members').insert({ org_id: org.id, user_id: user.id, role: 'owner' });
    return org.id;
  }

  // Lost a race with another concurrent call for this same user: organizations.owner_id is
  // unique, so the winner's row is this user's org too — fetch it instead of returning null.
  if (!violatesOwnerConstraint(error)) return null;
  const { data: winner } = await supabase
    .from('organizations')
    .select('id')
    .eq('owner_id', user.id)
    .single();
  return winner?.id ?? null;
}
