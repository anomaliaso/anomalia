import type { PublishReceipt, RemotePostStatus, SocialPublisher } from './port';

export const NO_PROVIDER_NOTICE = 'Social publishing is not configured on this instance';

async function unavailable(): Promise<never> {
  throw new Error(NO_PROVIDER_NOTICE);
}

const GONE_STATUS: RemotePostStatus = {
  status: 'not_found',
  url: null,
  error: null,
  scheduledFor: null
};

async function refuse(): Promise<PublishReceipt> {
  return { ok: false, reason: 'no_provider' };
}

export const manualPublisher: SocialPublisher = {
  kind: 'manual',

  createProfile: unavailable,

  connectUrl: unavailable,

  adsConnectUrl: unavailable,

  pendingOAuthData: unavailable,

  selectLinkedInOrganization: unavailable,

  facebookPages: unavailable,

  selectFacebookPage: unavailable,

  accounts: () => Promise.resolve([]),

  publish: refuse,

  postStatus: () => Promise.resolve(GONE_STATUS),

  deletePost: () => Promise.resolve(),

  disconnectAccount: () => Promise.resolve(),

  analyticsPosts: () => Promise.resolve([])
};
