import { env } from '$env/dynamic/private';
import type { PublisherKind, SocialPublisher } from './port';
import { zernioPublisher } from './zernio';
import { manualPublisher } from './manual';

const KINDS: readonly PublisherKind[] = ['zernio', 'manual'];

export function resolvePublisher(
  kindRaw: string | null | undefined,
  apiKey: string | null | undefined
): SocialPublisher {
  const kind = KINDS.find((k) => k === kindRaw?.trim().toLowerCase());
  if (kind) return kind === 'zernio' ? zernioPublisher : manualPublisher;
  return apiKey ? zernioPublisher : manualPublisher;
}

export const publisher: SocialPublisher = resolvePublisher(env.SOCIAL_PUBLISHER, env.ZERNIO_API_KEY);

export type { AnalyticsPost, PublishInput, PublishReceipt, ProviderAccount, RemotePostStatus, PublisherKind, SocialPublisher } from './port';
