import type { PageServerLoad, Actions } from './$types';
import {
  updateProfile,
  uploadProfileAvatar,
  removeProfileAvatar
} from '$lib/server/settings-actions';

function splitName(full: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
  const { user } = await safeGetSession();
  if (!user) return { firstName: '', lastName: '', email: null, avatarUrl: null, hasCustomAvatar: false };

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const rawOauth = meta.avatar_url ?? meta.picture ?? meta.avatar;
  const oauthAvatar =
    typeof rawOauth === 'string' && /^https?:\/\//.test(rawOauth) ? rawOauth : null;

  const customAvatar =
    typeof profile?.avatar_url === 'string' && profile.avatar_url ? profile.avatar_url : null;
  const { firstName, lastName } = splitName(profile?.full_name);

  return {
    firstName,
    lastName,
    email: profile?.email ?? user.email ?? null,
    avatarUrl: customAvatar || oauthAvatar,
    hasCustomAvatar: !!customAvatar
  };
};

export const actions: Actions = {
  updateProfile,
  uploadProfileAvatar,
  removeProfileAvatar
};
