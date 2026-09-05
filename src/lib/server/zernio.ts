import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publisher } from './publishing';
import {
  fromZernioPlatform,
  normalizeFacebookPage,
  normalizeLinkedInOrg,
  mapZernioAnalyticsPosts,
  toZernioPlatform
} from './publishing/zernio';
import type {
  AdsConnectPlatform,
  AdsConnectUrlResult,
  FacebookPage,
  LinkedInOrg,
  PendingOAuthData,
  PublishInput,
  PublishReceipt,
  RemotePostStatus
} from './publishing/port';

export { toZernioPlatform, fromZernioPlatform, normalizeLinkedInOrg, normalizeFacebookPage, mapZernioAnalyticsPosts };
export type { LinkedInOrg, PendingOAuthData, FacebookPage };

type BrandRef = { id: string; name: string; zernio_profile_id: string | null };

/**
 * Written with the service role and not with the caller's session: this id is the profile the brand
 * publishes THROUGH, so another tenant's value on this row would inherit their connected accounts.
 * `20260905210000_self_write_columns.sql` keeps `authenticated` out of the column.
 */
export async function ensureBrandProfile(brand: BrandRef): Promise<string> {
  if (brand.zernio_profile_id) return brand.zernio_profile_id;

  const profileId = await publisher.createProfile({
    name: `Anomalia · ${brand.name}`,
    description: `Anomalia brand ${brand.id}`
  });
  const { createAdminClient } = await import('./supabase-admin');
  await createAdminClient().from('brands').update({ zernio_profile_id: profileId }).eq('id', brand.id);
  return profileId;
}

export async function getConnectUrl(
  profileId: string,
  platform: string,
  redirectUrl?: string,
  opts: { headless?: boolean } = {}
): Promise<string> {
  return publisher.connectUrl(profileId, platform, redirectUrl, opts);
}

export async function getAdsConnectUrl(
  profileId: string,
  platform: AdsConnectPlatform,
  redirectUrl?: string,
  opts: { force?: boolean; headless?: boolean; accountId?: string } = {}
): Promise<AdsConnectUrlResult> {
  return publisher.adsConnectUrl(profileId, platform, redirectUrl, opts);
}

export async function getPendingOAuthData(token: string): Promise<PendingOAuthData> {
  return publisher.pendingOAuthData(token);
}

export async function selectLinkedInOrganization(opts: {
  profileId: string;
  tempToken: string;
  userProfile: unknown;
  accountType: 'personal' | 'organization';
  selectedOrganization?: LinkedInOrg;
}): Promise<void> {
  return publisher.selectLinkedInOrganization({
    profileId: opts.profileId,
    tempToken: opts.tempToken,
    userProfile: opts.userProfile as PendingOAuthData['userProfile'],
    accountType: opts.accountType,
    selectedOrganization: opts.selectedOrganization
  });
}

export async function getFacebookPages(opts: {
  profileId: string;
  tempToken: string;
  connectToken: string;
}): Promise<FacebookPage[]> {
  return publisher.facebookPages(opts);
}

export async function selectFacebookPage(opts: {
  profileId: string;
  pageId: string;
  tempToken: string;
  connectToken: string;
  userProfile: unknown;
  redirectUrl?: string;
}): Promise<void> {
  return publisher.selectFacebookPage({
    profileId: opts.profileId,
    pageId: opts.pageId,
    tempToken: opts.tempToken,
    connectToken: opts.connectToken,
    userProfile: opts.userProfile as PendingOAuthData['userProfile'],
    redirectUrl: opts.redirectUrl
  });
}

export async function syncBrandAccounts(
  supabase: SupabaseClient,
  brand: { id: string; zernio_profile_id: string | null }
): Promise<void> {
  if (!brand.zernio_profile_id) return;

  const accounts = await publisher.accounts(brand.zernio_profile_id);
  const live = new Set<string>();

  for (const acc of accounts) {
    live.add(acc.id);
    await supabase.from('social_accounts').upsert(
      {
        brand_id: brand.id,
        zernio_account_id: acc.id,
        platform: fromZernioPlatform(acc.platform),
        username: acc.username,
        display_name: acc.displayName,
        profile_url: acc.profileUrl,
        status: acc.active ? 'active' : 'disconnected'
      },
      { onConflict: 'brand_id,zernio_account_id' }
    );
  }

  const { data: stored } = await supabase
    .from('social_accounts')
    .select('zernio_account_id')
    .eq('brand_id', brand.id);
  for (const s of stored ?? []) {
    if (!live.has(s.zernio_account_id)) {
      await supabase
        .from('social_accounts')
        .update({ status: 'disconnected' })
        .eq('brand_id', brand.id)
        .eq('zernio_account_id', s.zernio_account_id);
    }
  }
}

export async function disconnectAccount(accountId: string): Promise<void> {
  return publisher.disconnectAccount(accountId);
}

export async function getPostStatus(postId: string): Promise<RemotePostStatus> {
  return publisher.postStatus(postId);
}

export async function deletePost(postId: string): Promise<void> {
  return publisher.deletePost(postId);
}

export async function publishPost(opts: PublishInput): Promise<PublishReceipt> {
  return publisher.publish(opts);
}

export async function syncZernioAnalytics(
  supabase: SupabaseClient,
  brand: { id: string; zernio_profile_id: string | null }
): Promise<number> {
  if (!brand.zernio_profile_id) return 0;
  const posts = await publisher.analyticsPosts(brand.zernio_profile_id);
  if (!posts.length) return 0;
  const rows = posts.map((p) => ({
    brand_id: brand.id,
    source: 'zernio',
    external_post_id: p.externalId,
    platform: p.platform,
    content: p.content,
    media_type: p.mediaType,
    platform_post_url: p.url,
    published_at: p.publishedAt,
    metrics: p.metrics,
    synced_at: new Date().toISOString()
  }));
  const { error } = await supabase
    .from('social_post_history')
    .upsert(rows, { onConflict: 'brand_id,source,external_post_id' });
  if (error) {
    console.warn('[flywheel] zernio analytics upsert failed:', error.message);
    return 0;
  }

  const newest = rows
    .map((r) => r.published_at)
    .filter((d): d is string => typeof d === 'string' && !!d)
    .sort()
    .at(-1);
  await supabase
    .from('brands')
    .update({ own_history_at: newest ?? new Date().toISOString() })
    .eq('id', brand.id)
    .then(({ error: cursorErr }) => {
      if (cursorErr) console.warn('[flywheel] own_history_at update failed:', cursorErr.message);
    });

  return rows.length;
}
