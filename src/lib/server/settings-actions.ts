import { swallow } from '$lib/server/swallow';
import { hasManyTenants } from '$lib/server/tenancy';
import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { syncBrandAccounts, disconnectAccount } from '$lib/server/zernio';
import { isPaidPlan, canConnectSocials, plansAbove } from '$lib/server/plans';
import { generateApiKey } from '$lib/server/cli-auth';
import { sendEmail, brandInviteEmailSubject, brandInviteEmailHtml, brandInviteEmailText } from '$lib/server/email';
import { emailLocale } from '$lib/server/email-i18n';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestEvent } from '@sveltejs/kit';
import { isChatTier, isGatewayModelTier } from '$lib/chat-tiers';
import { invalidateBrandNav } from '$lib/server/nav-cache';
import { readUploadImage } from '$lib/server/raster-image';
import { createAdminClient } from '$lib/server/supabase-admin';
import { setJobEnabled } from '$lib/server/job-roster';

const stripeApi = () => import('$lib/server/stripe');

/** Shared brands (0077): members reach settings too; billing/team stay owner-only. */
export async function isBrandOwner(supabase: SupabaseClient, slug: string): Promise<boolean> {
  const { data } = await supabase
    .from('brands')
    .select('id, organizations!inner(id)')
    .eq('slug', slug)
    .maybeSingle();
  return !!data;
}

const FEEDBACK: Record<string, string> = {
  too_expensive: 'too_expensive',
  unused: 'unused',
  missing_features: 'missing_features',
  switched_service: 'switched_service',
  other: 'other'
};

type Ev = RequestEvent;

export async function billingPortal({ request, params, url, locals: { supabase } }: Ev) {
  if (!(await isBrandOwner(supabase, params.brand!))) return fail(403, { billingError: 'Owner only' });
  const data = await request.formData();
  const flowRaw = String(data.get('flow') ?? 'invoices');
  const flow = flowRaw === 'payment_method' || flowRaw === 'upgrade' ? flowRaw : undefined;

  const { data: brand } = await supabase
    .from('brands')
    .select('slug, stripe_customer_id, stripe_subscription_id')
    .eq('slug', params.brand!)
    .maybeSingle();
  if (!brand) return fail(404, { billingError: 'Brand not found' });
  if (!brand.stripe_customer_id) throw redirect(303, `/app/${brand.slug}/activate`);

  let portalUrl: string;
  try {
    const { createBillingPortalSession } = await stripeApi();
    portalUrl = await createBillingPortalSession({
      customerId: brand.stripe_customer_id,
      returnUrl: `${url.origin}/app/${brand.slug}/settings/billing`,
      flow,
      subscriptionId: brand.stripe_subscription_id
    });
  } catch (e) {
    return fail(500, { billingError: e instanceof Error ? e.message : 'Could not open billing' });
  }
  throw redirect(303, portalUrl);
}

export async function upgrade({ request, params, url, locals: { supabase } }: Ev) {
  if (!(await isBrandOwner(supabase, params.brand!))) return fail(403, { billingError: 'Owner only' });
  const data = await request.formData();
  const plan = String(data.get('plan') ?? '');

  const { data: brand } = await supabase
    .from('brands')
    .select('slug, plan, stripe_customer_id, stripe_subscription_id')
    .eq('slug', params.brand!)
    .maybeSingle();
  if (!brand) return fail(404, { billingError: 'Brand not found' });
  // Same ladder as the settings modal / chat widget — Go included only while FEATURE_PLAN_GO is on.
  if (!plansAbove(brand.plan).some((p) => p.key === plan)) {
    return fail(400, { billingError: 'Unknown plan' });
  }
  if (!brand.stripe_customer_id || !brand.stripe_subscription_id) {
    throw redirect(303, `/app/${brand.slug}/activate?plan=${encodeURIComponent(plan)}`);
  }

  let upgradeUrl: string;
  try {
    const { createUpgradePortalSession } = await stripeApi();
    upgradeUrl = await createUpgradePortalSession({
      customerId: brand.stripe_customer_id,
      subscriptionId: brand.stripe_subscription_id,
      plan,
      returnUrl: `${url.origin}/app/${brand.slug}/settings/billing`
    });
  } catch (e) {
    return fail(500, { billingError: e instanceof Error ? e.message : 'Could not start the upgrade' });
  }
  throw redirect(303, upgradeUrl);
}

export async function applyRetention({ params, locals: { supabase } }: Ev) {
  if (!(await isBrandOwner(supabase, params.brand!))) return fail(403, { billingError: 'Owner only' });
  const coupon = env.STRIPE_RETENTION_COUPON;
  if (!coupon) return fail(400, { billingError: 'Retention offer is not configured.' });

  const { data: brand } = await supabase
    .from('brands')
    .select('stripe_subscription_id')
    .eq('slug', params.brand!)
    .maybeSingle();
  if (!brand?.stripe_subscription_id) return fail(400, { billingError: 'No active subscription.' });

  try {
    const { applyRetentionCoupon } = await stripeApi();
    await applyRetentionCoupon(brand.stripe_subscription_id, coupon);
  } catch (e) {
    return fail(500, { billingError: e instanceof Error ? e.message : 'Could not apply the offer' });
  }
  return { retentionApplied: true };
}

export async function cancelPlan({ request, params, locals: { supabase } }: Ev) {
  if (!(await isBrandOwner(supabase, params.brand!))) return fail(403, { billingError: 'Owner only' });
  const data = await request.formData();
  const reason = String(data.get('reason') ?? '');
  const comment = String(data.get('explanation') ?? '').trim();

  const { data: brand } = await supabase
    .from('brands')
    .select('plan, stripe_subscription_id')
    .eq('slug', params.brand!)
    .maybeSingle();
  if (!isPaidPlan(brand?.plan)) return fail(400, { billingError: 'No paid plan to cancel.' });
  if (!brand?.stripe_subscription_id) return fail(400, { billingError: 'No active subscription.' });

  let endsAt: string | null = null;
  try {
    const { cancelSubscriptionAtPeriodEnd } = await stripeApi();
    ({ endsAt } = await cancelSubscriptionAtPeriodEnd(brand.stripe_subscription_id, {
      feedback: FEEDBACK[reason],
      comment
    }));
  } catch (e) {
    return fail(500, { billingError: e instanceof Error ? e.message : 'Could not cancel the plan' });
  }
  return { canceled: true, endsAt };
}

export async function deleteBrand({ request, params, locals: { supabase } }: Ev) {
  if (!(await isBrandOwner(supabase, params.brand!))) return fail(403, { deleteError: 'failed' });
  const data = await request.formData();
  const confirm = String(data.get('confirm') ?? '').trim();

  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, slug, stripe_subscription_id')
    .eq('slug', params.brand!)
    .maybeSingle();
  if (!brand) return fail(404, { deleteError: 'failed' });
  if (confirm !== brand.name) return fail(400, { deleteError: 'nameMismatch' });

  if (brand.stripe_subscription_id) {
    try {
      const { ensureSubscriptionCanceled } = await stripeApi();
      await ensureSubscriptionCanceled(brand.stripe_subscription_id);
    } catch (e) {
      return fail(400, {
        deleteError: e instanceof Error && e.message === 'active_plan' ? 'activePlan' : 'failed'
      });
    }
  }

  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('zernio_account_id')
    .eq('brand_id', brand.id);
  for (const a of accounts ?? []) {
    if (a.zernio_account_id) await disconnectAccount(a.zernio_account_id).catch(swallow('disconnect zernio account'));
  }

  // La stessa guardia della pagina, ma qui serve DAVVERO: in SvelteKit l'azione POST gira anche
  // quando il `load` della sua route risponde 404, quindi nascondere lo schermo non basta.
  if (!hasManyTenants()) return fail(404, { deleteError: 'not_found' });

  const { error } = await supabase.from('brands').delete().eq('id', brand.id);
  if (error) return fail(500, { deleteError: 'failed' });
  invalidateBrandNav(params.brand!);
  throw redirect(303, '/app');
}

/**
 * Il modello su cui partono le chat nuove di questo brand. Vuoto = nessuna scelta: il brand
 * segue il default globale del catalogo, e continuera` a seguirlo quando cambia.
 */
export async function setChatDefaultTier({ request, params, locals: { supabase } }: Ev) {
  const data = await request.formData();
  const tier = String(data.get('tier') ?? '').trim();
  if (!tier) {
    const { error } = await supabase
      .from('brands')
      .update({ chat_default_tier: null })
      .eq('slug', params.brand!);
    if (error) return { error: error.message };
    invalidateBrandNav(params.brand!);
    return { chatTierSaved: true };
  }
  if (!isChatTier(tier)) return { error: 'Pick a model' };
  // Un id che ha la forma giusta ma che il gateway non serve sarebbe un default rotto per ogni
  // chat nuova del brand: qui si controlla che sia una scelta davvero offerta.
  if (isGatewayModelTier(tier)) {
    const { isOfferedChatModel } = await import('$lib/server/chat-models');
    if (!(await isOfferedChatModel(tier))) return { error: 'That model is not available' };
  }
  const { error } = await supabase
    .from('brands')
    .update({ chat_default_tier: tier })
    .eq('slug', params.brand!);
  if (error) return { error: error.message };
  invalidateBrandNav(params.brand!);
  return { chatTierSaved: true };
}

export async function setTimezone({ request, params, locals: { supabase } }: Ev) {
  const data = await request.formData();
  const tz = String(data.get('timezone') ?? '').trim();
  if (!tz) return { error: 'Pick a timezone' };
  const { error } = await supabase.from('brands').update({ timezone: tz }).eq('slug', params.brand!);
  if (error) return { error: error.message };
  invalidateBrandNav(params.brand!);
  return { tzSaved: true };
}

/** Main brand website — drives Content Library crawl + SEO/GEO. Also mirrors onto brand_kit.source_url. */
export async function setWebsite({ request, params, locals: { supabase } }: Ev) {
  const data = await request.formData();
  const raw = String(data.get('website') ?? '').trim();
  let website: string | null = null;
  if (raw) {
    website = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      new URL(website);
    } catch {
      return { websiteError: 'Invalid URL' };
    }
  }
  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', params.brand!)
    .maybeSingle();
  if (!brand) return { websiteError: 'Brand not found' };
  const { error } = await supabase.from('brands').update({ website }).eq('id', brand.id);
  if (error) return { websiteError: error.message };
  await supabase.from('brand_kit').update({ source_url: website }).eq('brand_id', brand.id);
  invalidateBrandNav(params.brand!);
  return { websiteSaved: true };
}

export async function sync({ params, locals: { supabase } }: Ev) {
  const { data: brand } = await supabase
    .from('brands')
    .select('id, plan, status, zernio_profile_id')
    .eq('slug', params.brand!)
    .maybeSingle();
  if (!brand) return { error: 'Brand not found' };
  if (!canConnectSocials(brand.plan, brand.status)) {
    return { error: 'Paid plan required' };
  }
  try {
    await syncBrandAccounts(supabase, brand);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Sync failed' };
  }
  return { synced: true };
}

export async function disconnect({ request, params, locals: { supabase } }: Ev) {
  const data = await request.formData();
  const id = String(data.get('id') ?? '');
  if (!id) return { error: 'Missing account' };

  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', params.brand!)
    .maybeSingle();
  if (!brand) return { error: 'Brand not found' };

  const { data: acc } = await supabase
    .from('social_accounts')
    .select('id, zernio_account_id')
    .eq('id', id)
    .eq('brand_id', brand.id)
    .maybeSingle();
  if (!acc) return { error: 'Account not found' };

  try {
    await disconnectAccount(acc.zernio_account_id);
  } catch (error) { swallow('disconnect zernio account', error); }
  await supabase.from('social_accounts').delete().eq('id', acc.id).eq('brand_id', brand.id);
  invalidateBrandNav(params.brand!);
  return { disconnected: true };
}

export async function setAutopilot({ request, params, locals: { supabase } }: Ev) {
  const data = await request.formData();
  const enabled = String(data.get('enabled') ?? '') === 'true';
  // Il toggle scrive l'opt-out del roster (chiave 'autopilot'), non più il booleano
  // `brands.autopilot_enabled` — ritirato: il producer è un agente della squadra come gli altri,
  // e questo interruttore e quello sulla pagina /agents devono essere LO STESSO interruttore.
  // La lettura del brand col client utente è l'autorizzazione (RLS); la scrittura passa
  // dall'admin perché brand_job_optouts è solo service-role.
  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', params.brand!)
    .maybeSingle();
  if (!brand) return { autopilotError: 'Brand not found' };
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const res = await setJobEnabled(createAdminClient(), {
    brandId: brand.id,
    jobKey: 'autopilot',
    enabled,
    userId: user?.id ?? null
  });
  if (!res.ok) return { autopilotError: 'Could not save the toggle — try again.' };
  if (enabled) {
    // Riaccendere azzera anche la serie di fallimenti: il watchdog riparte da zero.
    await supabase.from('brands').update({ autopilot_failure_count: 0 }).eq('id', brand.id);
  }
  invalidateBrandNav(params.brand!);
  return { autopilotSaved: true, autopilotEnabled: enabled };
}

export async function invite({ request, params, url, cookies, locals: { supabase } }: Ev) {
  const fd = await request.formData();
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, { teamError: 'Invalid email' });

  const { data: brand } = await supabase
    .from('brands')
    .select('id, name')
    .eq('slug', params.brand!)
    .maybeSingle();
  if (!brand) return fail(404, { teamError: 'Brand not found' });

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return fail(401, { teamError: 'Not authenticated' });
  if (email === user.email?.toLowerCase()) return fail(400, { teamError: 'That’s you' });

  const { error } = await supabase.from('brand_invites').insert({
    brand_id: brand.id,
    email,
    brand_name: brand.name,
    inviter_email: user.email ?? null,
    invited_by: user.id
  });
  if (error) {
    return fail(400, { teamError: error.code === '23505' ? 'Already invited' : error.message });
  }

  let emailSent = true;
  try {
    const locale = emailLocale(cookies.get('locale'));
    const inviter = user.email ?? 'A teammate';
    const acceptUrl = `${url.origin}/app?view=invites`;
    await sendEmail({
      to: email,
      subject: brandInviteEmailSubject(locale, brand.name, inviter),
      html: brandInviteEmailHtml(locale, brand.name, inviter, email, acceptUrl, url.origin),
      text: brandInviteEmailText(locale, brand.name, inviter, email, acceptUrl)
    });
  } catch {
    emailSent = false;
  }
  return { teamInvited: true, emailSent };
}

export async function revokeInvite({ request, locals: { supabase } }: Ev) {
  const fd = await request.formData();
  const id = String(fd.get('invite_id') ?? '');
  if (!id) return fail(400, { teamError: 'Missing invite' });

  const { data: inv } = await supabase
    .from('brand_invites')
    .select('id, brand_id, accepted_by')
    .eq('id', id)
    .maybeSingle();
  if (!inv) return fail(404, { teamError: 'Invite not found' });

  if (inv.accepted_by) {
    await supabase.from('brand_members').delete().eq('brand_id', inv.brand_id).eq('user_id', inv.accepted_by);
  }
  const { error } = await supabase.from('brand_invites').delete().eq('id', inv.id);
  if (error) return fail(500, { teamError: error.message });
  return { teamRevoked: true };
}

export async function createApiKey({ request, params, locals: { supabase } }: Ev) {
  const data = await request.formData();
  const name = String(data.get('key_name') ?? '').trim() || 'API Key';
  const writeAccess = String(data.get('write') ?? '') === 'true';
  const allBrands = String(data.get('all_brands') ?? '') === 'true';

  const { data: brand } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', params.brand!)
    .maybeSingle();
  if (!brand) return fail(404, { apiKeyError: 'Brand not found' });

  const { raw, hash, prefix } = await generateApiKey();

  const permissions = {
    brand_ids: allBrands ? '*' : [brand.id],
    scopes: writeAccess ? ['read', 'write'] : ['read']
  };

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return fail(401, { apiKeyError: 'Not authenticated' });

  const { error } = await supabase
    .from('api_keys')
    .insert({ user_id: user.id, name, key_hash: hash, key_prefix: prefix, permissions });

  if (error) return fail(500, { apiKeyError: error.message });

  return { apiKeyCreated: true, apiKeyRaw: raw, apiKeyName: name };
}

export async function revokeApiKey({ request, locals: { supabase } }: Ev) {
  const data = await request.formData();
  const id = String(data.get('key_id') ?? '');
  if (!id) return fail(400, { apiKeyError: 'Missing key ID' });

  const { error } = await supabase.from('api_keys').delete().eq('id', id);
  if (error) return fail(500, { apiKeyError: error.message });

  return { apiKeyRevoked: true };
}

/** Update the signed-in user's display name (first + last → profiles.full_name). */
export async function updateProfile({
  request,
  locals: { supabase, safeGetSession }
}: Ev) {
  const { user } = await safeGetSession();
  if (!user) return fail(401, { error: 'unauthorized' });
  const fd = await request.formData();
  const firstName = String(fd.get('firstName') ?? '')
    .trim()
    .slice(0, 80);
  const lastName = String(fd.get('lastName') ?? '')
    .trim()
    .slice(0, 80);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').slice(0, 160);
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: fullName || null })
    .eq('id', user.id);
  if (error) return fail(500, { error: error.message });
  return { profileSaved: true };
}

/** Upload / replace the signed-in user's profile photo → profiles.avatar_url. */
export async function uploadProfileAvatar({
  request,
  locals: { supabase, safeGetSession }
}: Ev) {
  const { user } = await safeGetSession();
  if (!user) return fail(401, { error: 'unauthorized' });
  const fd = await request.formData();
  const file = fd.get('avatar');
  if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'no_file' });
  const img = await readUploadImage(file, { maxOutBytes: 2_000_000 });
  if (!img.ok) return fail(400, { error: img.error === 'too_large' ? 'too_large' : 'not_image' });

  const ext = img.mime.includes('png') ? 'png' : 'jpg';
  const path = `${user.id}/profile/avatar-${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage
    .from('media')
    .upload(path, img.bytes, { contentType: img.mime, upsert: false });
  if (up.error) return fail(500, { error: up.error.message });

  const avatarUrl = supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', user.id);
  if (error) return fail(500, { error: error.message });
  return { avatarUploaded: true };
}

/** Clear profiles.avatar_url (falls back to OAuth picture if any). */
export async function removeProfileAvatar({ locals: { supabase, safeGetSession } }: Ev) {
  const { user } = await safeGetSession();
  if (!user) return fail(401, { error: 'unauthorized' });
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', user.id);
  if (error) return fail(500, { error: error.message });
  return { avatarRemoved: true };
}
