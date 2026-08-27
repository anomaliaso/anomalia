export type PublisherKind = 'zernio' | 'manual';

export type LinkedInOrg = { id: string; urn: string; name: string; logoUrl?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpaqueProfile = any;

export type PendingOAuthData = {
  tempToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  userProfile: OpaqueProfile;
  organizations: LinkedInOrg[];
  selectionType: string | null;
};

export type FacebookPage = { id: string; name: string; username?: string; category?: string };

export type ProviderAccount = {
  id: string;
  platform: string | null;
  username: string | null;
  displayName: string | null;
  profileUrl: string | null;
  active: boolean;
};

export type ProfileInput = { name: string; description: string };

export type AdsConnectPlatform =
  | 'facebook'
  | 'googleads'
  | 'instagram'
  | 'linkedin'
  | 'tiktok'
  | 'twitter'
  | 'pinterest';

export type AdsConnectUrlResult = { authUrl: string } | { alreadyConnected: true; accountId?: string };

export type LinkedInSelectInput = {
  profileId: string;
  tempToken: string;
  userProfile: OpaqueProfile;
  accountType: 'personal' | 'organization';
  selectedOrganization?: LinkedInOrg;
};

export type FacebookPagesInput = { profileId: string; tempToken: string; connectToken: string };

export type FacebookSelectInput = {
  profileId: string;
  pageId: string;
  tempToken: string;
  connectToken: string;
  userProfile: OpaqueProfile;
  redirectUrl?: string;
};

export type ConnectOptions = { headless?: boolean };

export type AdsConnectOptions = { force?: boolean; headless?: boolean; accountId?: string };

export type PublishInput = {
  accountId: string;
  platform: string;
  content: string;
  mediaUrls?: string[];
  scheduledFor?: string;
  aiGeneratedMedia?: boolean;
  redditTitle?: string;
  redditLinkUrl?: string;
  redditSubreddit?: string;
  youtubeTitle?: string;
  youtubeThumbnail?: string;
};

export type PublishReceipt = { ok: true; postId?: string } | { ok: false; reason: 'no_provider' };

export type RemotePostStatus = {
  status: string;
  url: string | null;
  error: string | null;
  scheduledFor: string | null;
};

export type AnalyticsMetrics = {
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  impressions?: number;
  views?: number;
  engagementRate?: number;
};

export type AnalyticsPost = {
  externalId: string;
  platform: string | null;
  content: string | null;
  publishedAt: string | null;
  mediaType: string | null;
  url: string | null;
  metrics: AnalyticsMetrics;
};

export interface SocialPublisher {
  readonly kind: PublisherKind;

  createProfile(input: ProfileInput): Promise<string>;

  connectUrl(profileId: string, platform: string, redirectUrl?: string, opts?: ConnectOptions): Promise<string>;

  adsConnectUrl(
    profileId: string,
    platform: AdsConnectPlatform,
    redirectUrl?: string,
    opts?: AdsConnectOptions
  ): Promise<AdsConnectUrlResult>;

  pendingOAuthData(token: string): Promise<PendingOAuthData>;

  selectLinkedInOrganization(input: LinkedInSelectInput): Promise<void>;

  facebookPages(input: FacebookPagesInput): Promise<FacebookPage[]>;

  selectFacebookPage(input: FacebookSelectInput): Promise<void>;

  accounts(profileId: string): Promise<ProviderAccount[]>;

  publish(input: PublishInput): Promise<PublishReceipt>;

  postStatus(postId: string): Promise<RemotePostStatus>;

  deletePost(postId: string): Promise<void>;

  disconnectAccount(accountId: string): Promise<void>;

  analyticsPosts(profileId: string, maxPages?: number): Promise<AnalyticsPost[]>;
}
