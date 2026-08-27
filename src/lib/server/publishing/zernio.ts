import { env } from '$env/dynamic/private';
import { isVideoUrl } from '$lib/content-formats';
import { youtubeTitleFrom } from '$lib/platform-limits';
import type {
  AdsConnectPlatform,
  AdsConnectUrlResult,
  AnalyticsPost,
  ConnectOptions,
  FacebookPage,
  FacebookPagesInput,
  FacebookSelectInput,
  LinkedInOrg,
  LinkedInSelectInput,
  PendingOAuthData,
  ProfileInput,
  ProviderAccount,
  PublishInput,
  PublishReceipt,
  RemotePostStatus,
  SocialPublisher
} from './port';

const DEFAULT_BASE_URL = 'https://zernio.com/api/v1';

function baseUrl(): string {
  return env.ZERNIO_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

function apiKey(): string {
  const k = env.ZERNIO_API_KEY;
  if (!k) throw new Error('ZERNIO_API_KEY not configured');
  return k;
}

async function zfetch(path: string, init?: RequestInit) {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  if (!res.ok) throw new Error(`Zernio ${res.status}: ${await res.text()}`);
  return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function objId(o: any): string | undefined {
  return o?.id ?? o?._id;
}

const TO_ZERNIO: Record<string, string> = { x: 'twitter' };
const FROM_ZERNIO: Record<string, string> = { twitter: 'x' };
export const toZernioPlatform = (p: string): string => TO_ZERNIO[p] ?? p;
export const fromZernioPlatform = (p: string | null | undefined): string | null =>
  p == null ? null : (FROM_ZERNIO[p] ?? p);

async function createProfile(input: ProfileInput): Promise<string> {
  const created = await zfetch('/profiles', {
    method: 'POST',
    body: JSON.stringify({ name: input.name, description: input.description })
  });
  const profileId = objId(created.profile) ?? objId(created);
  if (!profileId) throw new Error('Zernio: could not create profile');
  return profileId;
}

async function connectUrl(
  profileId: string,
  platform: string,
  redirectUrl?: string,
  opts: ConnectOptions = {}
): Promise<string> {
  const params = new URLSearchParams({ profileId });
  if (redirectUrl) params.set('redirect_url', redirectUrl);
  if (opts.headless) params.set('headless', 'true');
  const data = await zfetch(`/connect/${encodeURIComponent(toZernioPlatform(platform))}?${params.toString()}`);
  const url = data.authUrl ?? data.url;
  if (!url) throw new Error('Zernio: no connect URL returned');
  return url;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeLinkedInOrg(o: any): LinkedInOrg | null {
  const id = String(o?.id ?? o?.organizationId ?? '').trim();
  const urn = String(o?.urn ?? o?.organizationUrn ?? (id ? `urn:li:organization:${id}` : '')).trim();
  if (!urn) return null;
  const derivedId = id || urn.split(':').pop() || '';
  return {
    id: derivedId,
    urn,
    name: String(o?.name ?? o?.localizedName ?? o?.vanityName ?? 'Company Page'),
    logoUrl: o?.logoUrl ?? o?.logo ?? undefined
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeFacebookPage(p: any): FacebookPage | null {
  const id = String(p?.id ?? p?.pageId ?? '').trim();
  if (!id) return null;
  return {
    id,
    name: String(p?.name ?? p?.username ?? 'Facebook Page'),
    username: p?.username ?? undefined,
    category: p?.category ?? undefined
  };
}

async function pendingOAuthData(token: string): Promise<PendingOAuthData> {
  const data = await zfetch(`/connect/pending-data?token=${encodeURIComponent(token)}`);
  const orgs = Array.isArray(data?.organizations) ? data.organizations : [];
  return {
    tempToken: data?.tempToken ?? '',
    refreshToken: data?.refreshToken ?? null,
    expiresIn: typeof data?.expiresIn === 'number' ? data.expiresIn : null,
    userProfile: data?.userProfile ?? null,
    organizations: orgs
      .map(normalizeLinkedInOrg)
      .filter((o: LinkedInOrg | null): o is LinkedInOrg => o !== null),
    selectionType: data?.selectionType ?? null
  };
}

async function selectLinkedInOrganization(input: LinkedInSelectInput): Promise<void> {
  await zfetch('/connect/linkedin/select-organization', {
    method: 'POST',
    body: JSON.stringify({
      profileId: input.profileId,
      tempToken: input.tempToken,
      userProfile: input.userProfile,
      accountType: input.accountType,
      selectedOrganization:
        input.accountType === 'organization' ? input.selectedOrganization : undefined
    })
  });
}

async function facebookPages(input: FacebookPagesInput): Promise<FacebookPage[]> {
  const qs = new URLSearchParams({ profileId: input.profileId, tempToken: input.tempToken });
  const data = await zfetch(`/connect/facebook/select-page?${qs.toString()}`, {
    headers: { 'X-Connect-Token': input.connectToken }
  });
  const pages = Array.isArray(data?.pages) ? data.pages : [];
  return pages
    .map(normalizeFacebookPage)
    .filter((p: FacebookPage | null): p is FacebookPage => p !== null);
}

async function selectFacebookPage(input: FacebookSelectInput): Promise<void> {
  await zfetch('/connect/facebook/select-page', {
    method: 'POST',
    headers: { 'X-Connect-Token': input.connectToken },
    body: JSON.stringify({
      profileId: input.profileId,
      pageId: input.pageId,
      tempToken: input.tempToken,
      userProfile: input.userProfile,
      redirect_url: input.redirectUrl
    })
  });
}

async function adsConnectUrl(
  profileId: string,
  platform: AdsConnectPlatform,
  redirectUrl?: string,
  opts: { force?: boolean; headless?: boolean; accountId?: string } = {}
): Promise<AdsConnectUrlResult> {
  const params = new URLSearchParams({ profileId });
  if (redirectUrl) params.set('redirect_url', redirectUrl);
  if (opts.force) params.set('force', 'true');
  if (opts.headless) params.set('headless', 'true');
  if (opts.accountId) params.set('accountId', opts.accountId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await zfetch(`/connect/${encodeURIComponent(platform)}/ads?${params.toString()}`);
  if (data?.alreadyConnected) {
    return { alreadyConnected: true, accountId: data.accountId ? String(data.accountId) : undefined };
  }
  const url = data?.authUrl ?? data?.url;
  if (!url) throw new Error('Zernio: no ads connect URL returned');
  return { authUrl: String(url) };
}

async function accounts(profileId: string): Promise<ProviderAccount[]> {
  const data = await zfetch(`/accounts?profileId=${encodeURIComponent(profileId)}`);
  const rows = Array.isArray(data.accounts) ? data.accounts : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapped: ProviderAccount[] = rows.map((a: any) => ({
    id: objId(a),
    platform: a.platform ?? null,
    username: a.username ?? a.handle ?? null,
    displayName: a.displayName ?? a.name ?? null,
    profileUrl: a.profileUrl ?? null,
    active: a.isActive !== false
  }));
  return mapped.filter((a) => !!a.id);
}

const AI_DISCLOSURE_KEY: Record<string, string> = {
  instagram: 'isAiGenerated',
  twitter: 'madeWithAi',
  tiktok: 'video_made_with_ai',
  youtube: 'containsSyntheticMedia'
};

async function publish(opts: PublishInput): Promise<PublishReceipt> {
  const platformKey = toZernioPlatform(opts.platform);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformEntry: any = { platform: platformKey, accountId: opts.accountId };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const psd: any = {};

  if (platformKey === 'reddit') {
    if (opts.redditSubreddit) psd.subreddit = opts.redditSubreddit;
    if (opts.redditLinkUrl) psd.url = opts.redditLinkUrl;
  }

  if (platformKey === 'youtube') {
    const title = youtubeTitleFrom(opts.content, opts.youtubeTitle);
    if (title) psd.title = title;
  }

  const aiKey = AI_DISCLOSURE_KEY[platformKey];
  if (aiKey && opts.aiGeneratedMedia && opts.mediaUrls?.length) psd[aiKey] = true;

  if (Object.keys(psd).length) platformEntry.platformSpecificData = psd;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = {
    content: opts.content,
    platforms: [platformEntry]
  };
  if (opts.scheduledFor) payload.scheduledFor = opts.scheduledFor;
  else payload.publishNow = true;
  if (opts.mediaUrls?.length) {
    const thumb = platformKey === 'youtube' ? (opts.youtubeThumbnail ?? '').trim() : '';
    payload.mediaItems = opts.mediaUrls.map((url) => {
      const item: { type: string; url: string; thumbnail?: string } = {
        type: isVideoUrl(url) ? 'video' : 'image',
        url
      };
      if (thumb && item.type === 'video') item.thumbnail = thumb;
      return item;
    });
  }

  const res = await zfetch('/posts', { method: 'POST', body: JSON.stringify(payload) });
  return { ok: true, postId: objId(res.post) ?? objId(res) };
}

async function postStatus(postId: string): Promise<RemotePostStatus> {
  const data = await zfetch(`/posts/${encodeURIComponent(postId)}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = data.post ?? data;
  const plat = (p.platforms ?? [])[0] ?? {};
  const status = String(plat.status ?? p.status ?? 'unknown').toLowerCase();
  return {
    status,
    url: plat.platformPostUrl ?? plat.postUrl ?? null,
    error: plat.errorMessage ?? plat.error ?? p.errorMessage ?? null,
    scheduledFor: p.scheduledFor ?? p.scheduled_for ?? plat.scheduledFor ?? null
  };
}

async function deletePost(postId: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/posts/${encodeURIComponent(postId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey()}` }
  });
  if (!res.ok) throw new Error(`Zernio delete post ${res.status}: ${await res.text()}`);
}

async function disconnectAccount(accountId: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey()}` }
  });
  if (!res.ok) throw new Error(`Zernio delete ${res.status}: ${await res.text()}`);
}

const numOrU = (x: unknown): number | undefined => {
  const v = Number(x);
  return Number.isFinite(v) ? v : undefined;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapZernioAnalyticsPosts(data: any): AnalyticsPost[] {
  const posts = Array.isArray(data?.posts) ? data.posts : [];
  const out: AnalyticsPost[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const p of posts as any[]) {
    const plat = (p?.platforms ?? [])[0] ?? {};
    const a = p?.analytics ?? {};
    const externalId = String(p?._id ?? plat?.platformPostId ?? '');
    if (!externalId) continue;
    out.push({
      externalId,
      platform: fromZernioPlatform(plat?.platform),
      content: p?.content ?? null,
      publishedAt: p?.publishedAt ?? null,
      mediaType: p?.mediaType ?? p?.type ?? null,
      url: plat?.platformPostUrl ?? plat?.postUrl ?? null,
      metrics: {
        likes: numOrU(a.likes),
        comments: numOrU(a.comments),
        shares: numOrU(a.shares),
        saves: numOrU(a.saves),
        impressions: numOrU(a.impressions),
        views: numOrU(a.views),
        engagementRate: numOrU(a.engagementRate)
      }
    });
  }
  return out;
}

async function analyticsPosts(profileId: string, maxPages = 4): Promise<AnalyticsPost[]> {
  const out: AnalyticsPost[] = [];
  for (let page = 1; page <= maxPages; page++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    try {
      data = await zfetch(`/analytics?profileId=${encodeURIComponent(profileId)}&page=${page}&limit=50`);
    } catch {
      break;
    }
    const batch = mapZernioAnalyticsPosts(data);
    out.push(...batch);
    const pages = Number(data?.pagination?.pages) || page;
    if (!batch.length || page >= pages) break;
  }
  return out;
}

export const zernioPublisher: SocialPublisher = {
  kind: 'zernio',

  createProfile,

  connectUrl,

  adsConnectUrl,

  pendingOAuthData,

  selectLinkedInOrganization,

  facebookPages,

  selectFacebookPage,

  accounts,

  publish,

  postStatus,

  deletePost,

  disconnectAccount,

  analyticsPosts
};
