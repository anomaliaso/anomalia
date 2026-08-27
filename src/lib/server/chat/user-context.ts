import type { SupabaseClient } from '@supabase/supabase-js';

export type ChatUserContext = {
  userId: string;
  name: string | null;
  email: string | null;
  locale: string | null;
  orgRole: string | null;
  isOrgOwner: boolean;
  brandAccess: 'org_owner' | 'org_member' | 'shared';
};

/** Load who is chatting — profile + how they relate to this brand/org. */
export async function fetchChatUserContext(
  supabase: SupabaseClient,
  userId: string,
  brand: { id: string; org_id?: string | null }
): Promise<ChatUserContext | null> {
  if (!userId) return null;

  const orgId = brand.org_id ?? null;
  const [{ data: profile }, { data: brandMember }] = await Promise.all([
    supabase.from('profiles').select('full_name, email, locale').eq('id', userId).maybeSingle(),
    supabase.from('brand_members').select('user_id').eq('brand_id', brand.id).eq('user_id', userId).maybeSingle()
  ]);

  let orgRole: string | null = null;
  let isOrgOwner = false;

  if (orgId) {
    const [{ data: membership }, { data: org }] = await Promise.all([
      supabase.from('org_members').select('role').eq('org_id', orgId).eq('user_id', userId).maybeSingle(),
      supabase.from('organizations').select('owner_id').eq('id', orgId).maybeSingle()
    ]);
    orgRole = (membership?.role as string | null) ?? null;
    isOrgOwner = org?.owner_id === userId;
  }

  const brandAccess: ChatUserContext['brandAccess'] = isOrgOwner
    ? 'org_owner'
    : orgRole
      ? 'org_member'
      : brandMember
        ? 'shared'
        : 'org_member';

  return {
    userId,
    name: (profile?.full_name as string | null) ?? null,
    email: (profile?.email as string | null) ?? null,
    locale: (profile?.locale as string | null) ?? null,
    orgRole: isOrgOwner ? 'owner' : orgRole,
    isOrgOwner,
    brandAccess
  };
}

/** Prompt block so the model knows who it is talking to (name, email, access level). */
export function buildUserSection(ctx: ChatUserContext, replyLang: string): string {
  const displayName = ctx.name?.trim() || (ctx.email?.split('@')[0] ?? 'User');
  const access =
    ctx.brandAccess === 'org_owner'
      ? 'organization owner (full access to this brand)'
      : ctx.brandAccess === 'shared'
        ? 'shared collaborator (invited to this brand only)'
        : `organization member (${ctx.orgRole ?? 'member'})`;

  return `## USER (who you are talking to — the logged-in dashboard user)
Name: ${displayName}
Email: ${ctx.email ?? '(unknown)'}
User ID: ${ctx.userId}
Profile locale: ${ctx.locale ?? '(not set)'}
Access on this brand: ${access}

USER PLAYBOOK:
- Address them naturally by first name when it fits ("${displayName.split(/\s+/)[0]}").
- They are the human operator of this brand workspace — scheduling, approvals and billing decisions they confirm are authoritative.
- Match reply language to their messages; profile locale (${ctx.locale ?? replyLang}) is only a hint.
- Do not repeat their email in every reply unless they ask for it or it is needed (billing/support).`;
}
