import { error, fail, redirect } from '@sveltejs/kit';
import { soleTenantId } from '$lib/server/tenancy';
import { canEnter } from '$lib/server/access';
import type { Actions, PageServerLoad } from './$types';
import { ensureOrgForUser } from '$lib/server/org';
import { NON_PAYING_SLOT_LIMIT, hasUnlimitedSlots } from '$lib/server/brand-limits';
import { LAST_BRAND_COOKIE } from '$lib/shell-prefs';
import { GUEST_ONBOARDING_COOKIE, hasGuestOnboardingCookie } from '$lib/guest-onboarding';

// Pull a human label for a saved onboarding draft out of its opaque JSON snapshot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function draftLabel(draft: any): string {
  const d = draft && typeof draft === 'object' ? draft : {};
  const name = String(d.brandName ?? d.profile?.name ?? '').trim();
  if (name) return name;
  const niche = String(d.creatorNiche ?? '').trim();
  if (niche) return niche.length > 48 ? `${niche.slice(0, 48)}…` : niche;
  const url = String(d.url ?? '').trim();
  if (url) return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return '';
}

/** Views that still render the brands list UI (invite email deep-links, draft resume). */
const LIST_VIEWS = new Set(['invites', 'drafts']);

// Default `/app` → last brand (cookie) or newest brand; no brands → onboarding.
// `?view=invites|drafts` keeps the list page for those flows.
export const load: PageServerLoad = async ({ cookies, url, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) throw redirect(303, '/login');

  if (!(await canEnter(supabase))) throw redirect(303, '/waitlist');

  // UN TENANT SOLO: qui non c'è niente da scegliere. Si va al brand e basta — la lista, gli
  // inviti e la ripresa dell'onboarding ospite esistono tutti perché i brand sono più di uno.
  const sole = soleTenantId();
  if (sole) {
    const { data } = await supabase.from('brands').select('slug').eq('id', sole).maybeSingle();
    if (data?.slug) throw redirect(303, `/app/${data.slug}`);
    // Mai inventare un brand: se il puntatore non trova la riga, l'installazione è incompleta e
    // deve dirlo qui, non lasciare un'app che sembra vuota senza spiegare perché.
    throw error(500, `TENANT_BRAND_ID punta a un brand che non esiste (${sole}). Esegui il seed.`);
  }

  // Guest funnel finished socials before login: never dump them on an existing brand —
  // resume authenticated onboarding so analysis creates the NEW project.
  if (hasGuestOnboardingCookie(cookies.get(GUEST_ONBOARDING_COOKIE))) {
    throw redirect(303, '/app/onboarding');
  }

  const view = url.searchParams.get('view') ?? '';
  const keepList = LIST_VIEWS.has(view);

  // Default entry: never load the full brands list — we only need one slug to redirect.
  // RLS still scopes lookups to brands the user can access.
  if (!keepList) {
    const lastSlug = cookies.get(LAST_BRAND_COOKIE)?.trim() ?? '';
    if (lastSlug) {
      const { data: remembered } = await supabase
        .from('brands')
        .select('slug')
        .eq('slug', lastSlug)
        .maybeSingle();
      if (remembered?.slug) throw redirect(303, `/app/${remembered.slug}`);
    }

    const { data: newest } = await supabase
      .from('brands')
      .select('slug')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (newest?.slug) throw redirect(303, `/app/${newest.slug}`);

    // No brands: prefer pending invites / drafts over empty onboarding.
    const email = (user.email ?? '').toLowerCase();
    const [{ count: inviteCount }, { count: draftCount }] = await Promise.all([
      email
        ? supabase
            .from('brand_invites')
            .select('id', { count: 'exact', head: true })
            .eq('email', email)
            .is('accepted_at', null)
        : Promise.resolve({ count: 0 }),
      supabase
        .from('onboarding_drafts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
    ]);
    if ((inviteCount ?? 0) > 0) throw redirect(303, '/app?view=invites');
    if ((draftCount ?? 0) > 0) throw redirect(303, '/app?view=drafts');
    throw redirect(303, '/app/onboarding');
  }

  const [, { data: rows }, { data: draftRows }, { data: profile }, { data: inviteRows }] = await Promise.all([
    ensureOrgForUser(supabase, user),
    supabase
      .from('brands')
      .select('id, name, slug, website, status, brand_kit(favicon_url, logos), created_at')
      .order('created_at', { ascending: true }),
    supabase
      .from('onboarding_drafts')
      .select('id, phase, draft, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false }),
    supabase.from('profiles').select('full_name, email').eq('id', user.id).maybeSingle(),
    supabase
      .from('brand_invites')
      .select('id, brand_name, inviter_email, token, created_at')
      .eq('email', (user.email ?? '').toLowerCase())
      .is('accepted_at', null)
      .order('created_at', { ascending: false })
  ]);
  const invites = inviteRows ?? [];
  const drafts = (draftRows ?? [])
    .map((r) => ({ id: r.id, label: draftLabel(r.draft), phase: r.phase as string | null, updatedAt: r.updated_at as string }))
    .filter((d) => d.label);

  const brands = (rows ?? []).map((b) => {
    const kit = Array.isArray(b.brand_kit) ? b.brand_kit[0] : b.brand_kit;
    const logos = (kit?.logos as Array<{ url?: string }> | null) ?? null;
    const logoUrl = logos?.find((l) => l?.url)?.url ?? kit?.favicon_url ?? null;
    const { brand_kit: _drop, created_at: _c, ...rest } = b;
    return { ...rest, logoUrl };
  });

  const nonPayingUsed = (rows ?? []).filter((b) => b.status !== 'active').length + (draftRows ?? []).length;
  const canAddBrand = hasUnlimitedSlots(user.email) || nonPayingUsed < NON_PAYING_SLOT_LIMIT;

  const email = profile?.email ?? user.email ?? null;
  const userName =
    profile?.full_name?.trim() || (email ? email.split('@')[0] : null) || 'User';

  return { brands, drafts, invites, canAddBrand, slotLimit: NON_PAYING_SLOT_LIMIT, userName, userEmail: email };
};

export const actions: Actions = {
  // Dismiss a saved onboarding draft from the "Continue" list.
  discardDraft: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Not authenticated' });
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing id' });
    const { error } = await supabase.from('onboarding_drafts').delete().eq('id', id).eq('user_id', user.id);
    if (error) return fail(400, { error: error.message });
    return { discarded: true };
  },

  // Accept a brand invite (0077). The SECURITY DEFINER function validates token,
  // email match and expiry, adds the membership and returns the brand slug.
  acceptInvite: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { inviteError: 'Not authenticated' });
    const fd = await request.formData();
    const token = String(fd.get('token') ?? '');
    if (!token) return fail(400, { inviteError: 'Missing token' });
    const { data: slug, error } = await supabase.rpc('accept_brand_invite', { p_token: token });
    if (error || !slug) return fail(400, { inviteError: error?.message ?? 'expired' });
    throw redirect(303, `/app/${slug}`);
  },

  // Rename a brand.
  renameBrand: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { user } = await safeGetSession();
    if (!user) return fail(401, { error: 'Not authenticated' });
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    const name = String(fd.get('name') ?? '').trim();
    if (!id) return fail(400, { error: 'Missing id' });
    if (!name) return fail(400, { error: 'Missing name' });
    if (name.length > 80) return fail(400, { error: 'Name too long' });
    const { error } = await supabase.from('brands').update({ name }).eq('id', id);
    if (error) return fail(400, { error: error.message });
    return { renamed: true };
  }
};
