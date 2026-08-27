/**
 * Outbound webhooks: deliver a Composio trigger event to the brand's own endpoint.
 *
 * Composio posts every event to one URL per project, so this module is the fan-out — and the
 * part a customer actually judges: our signature, our retries, our delivery log.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ComposioTriggerEvent } from '$lib/server/composio';

export const MAX_DELIVERY_ATTEMPTS = 6;
/** Consecutive failures before the endpoint is parked; a dead URL must stop costing us retries. */
export const FAILURES_BEFORE_PAUSE = 20;
const DELIVERY_TIMEOUT_MS = 15_000;

export type BrandWebhookRow = {
  id: string;
  brand_id: string;
  url: string;
  secret: string;
  events: string[];
  status: 'active' | 'paused' | 'failing';
  failure_count: number;
  last_delivery_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type DeliveryRow = {
  id: string;
  brand_id: string;
  webhook_id: string | null;
  event_id: string;
  trigger_slug: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export const WEBHOOK_COLUMNS =
  'id, brand_id, url, secret, events, status, failure_count, last_delivery_at, last_error, created_at';

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/** Same scheme Composio uses on us: HMAC-SHA256 over `{id}.{timestamp}.{body}`, base64. */
export function signDelivery(opts: {
  secret: string;
  deliveryId: string;
  timestamp: string;
  body: string;
}): string {
  return createHmac('sha256', opts.secret)
    .update(`${opts.deliveryId}.${opts.timestamp}.${opts.body}`)
    .digest('base64');
}

/** Exponential backoff with a ceiling: 30s, 2m, 8m, 32m, 2h, capped at 6h. */
export function backoffMs(attempt: number): number {
  const base = 30_000 * 4 ** Math.max(0, attempt - 1);
  return Math.min(base, 6 * 60 * 60 * 1000);
}

/** An endpoint that wants everything subscribes to nothing in particular. */
export function wantsEvent(webhook: { events: string[] }, triggerSlug: string): boolean {
  return webhook.events.length === 0 || webhook.events.includes(triggerSlug);
}

/** A URL we will actually POST to: https only, no loopback, no private space. */
export function validateWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'That is not a valid URL.' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'The endpoint must be https.' };
  }
  const host = parsed.hostname.toLowerCase();
  const privateHost =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host.endsWith('.internal') ||
    host.endsWith('.local');
  if (privateHost) {
    return { ok: false, error: 'The endpoint must be reachable on the public internet.' };
  }
  return { ok: true, url: parsed.toString() };
}

export function eventBody(event: {
  eventId: string;
  triggerSlug: string;
  timestamp: string;
  data: unknown;
}): Record<string, unknown> {
  return {
    id: event.eventId,
    type: event.triggerSlug,
    created_at: event.timestamp,
    data: event.data
  };
}

export async function loadBrandWebhook(
  supabase: SupabaseClient,
  brandId: string
): Promise<BrandWebhookRow | null> {
  const { data } = await supabase
    .from('brand_webhooks')
    .select(WEBHOOK_COLUMNS)
    .eq('brand_id', brandId)
    .maybeSingle();
  return (data as BrandWebhookRow | null) ?? null;
}

/**
 * Record the event before trying to deliver it. The unique index on (brand, event) makes a
 * Composio retry a no-op instead of a second fan-out.
 */
export async function enqueueDelivery(
  supabase: SupabaseClient,
  opts: { brandId: string; webhookId: string; event: ComposioTriggerEvent }
): Promise<DeliveryRow | null> {
  const { data, error } = await supabase
    .from('webhook_deliveries')
    .insert({
      brand_id: opts.brandId,
      webhook_id: opts.webhookId,
      event_id: opts.event.eventId,
      trigger_slug: opts.event.triggerSlug,
      payload: eventBody(opts.event) as Record<string, unknown>
    })
    .select('id, brand_id, webhook_id, event_id, trigger_slug, payload, attempts')
    .single();
  if (error) {
    // 23505: we have seen this event already.
    if (error.code !== '23505') console.error('[brand-webhooks] enqueue', error.message);
    return null;
  }
  return data as DeliveryRow;
}

async function markWebhookResult(
  supabase: SupabaseClient,
  webhook: { id: string; failure_count: number },
  ok: boolean,
  error: string | null
): Promise<void> {
  const failureCount = ok ? 0 : webhook.failure_count + 1;
  await supabase
    .from('brand_webhooks')
    .update({
      failure_count: failureCount,
      last_delivery_at: new Date().toISOString(),
      last_error: ok ? null : (error ?? '').slice(0, 1000),
      status: failureCount >= FAILURES_BEFORE_PAUSE ? 'paused' : ok ? 'active' : 'failing',
      updated_at: new Date().toISOString()
    })
    .eq('id', webhook.id);
}

/** One attempt. Returns true when the endpoint accepted it (any 2xx). */
export async function attemptDelivery(
  supabase: SupabaseClient,
  delivery: DeliveryRow,
  webhook: BrandWebhookRow
): Promise<boolean> {
  const body = JSON.stringify(delivery.payload);
  const timestamp = new Date().toISOString();
  const attempt = delivery.attempts + 1;
  let responseStatus: number | null = null;
  let failure: string | null = null;

  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Anomalia-Webhooks/1',
        'anomalia-delivery-id': delivery.id,
        'anomalia-event-type': delivery.trigger_slug,
        'anomalia-timestamp': timestamp,
        'anomalia-signature': `v1,${signDelivery({
          secret: webhook.secret,
          deliveryId: delivery.id,
          timestamp,
          body
        })}`
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS)
    });
    responseStatus = res.status;
    if (!res.ok) failure = `Endpoint answered ${res.status}`;
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
  }

  const delivered = !failure;
  const exhausted = !delivered && attempt >= MAX_DELIVERY_ATTEMPTS;
  await supabase
    .from('webhook_deliveries')
    .update({
      attempts: attempt,
      status: delivered ? 'delivered' : exhausted ? 'failed' : 'pending',
      response_status: responseStatus,
      error: failure ? failure.slice(0, 1000) : null,
      delivered_at: delivered ? new Date().toISOString() : null,
      next_attempt_at: new Date(Date.now() + backoffMs(attempt)).toISOString()
    })
    .eq('id', delivery.id);
  await markWebhookResult(supabase, webhook, delivered, failure);
  return delivered;
}

/** Deliveries due for a retry, oldest first. The worker calls this. */
export async function claimDueDeliveries(
  supabase: SupabaseClient,
  limit = 20
): Promise<{ delivery: DeliveryRow; webhook: BrandWebhookRow }[]> {
  const { data } = await supabase
    .from('webhook_deliveries')
    .select('id, brand_id, webhook_id, event_id, trigger_slug, payload, attempts')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(limit);
  const rows = (data ?? []) as DeliveryRow[];
  const out: { delivery: DeliveryRow; webhook: BrandWebhookRow }[] = [];
  for (const delivery of rows) {
    if (!delivery.webhook_id) continue;
    const { data: webhook } = await supabase
      .from('brand_webhooks')
      .select(WEBHOOK_COLUMNS)
      .eq('id', delivery.webhook_id)
      .maybeSingle();
    // A paused endpoint stops consuming retries until someone re-enables it.
    if (!webhook || (webhook as BrandWebhookRow).status === 'paused') continue;
    out.push({ delivery, webhook: webhook as BrandWebhookRow });
  }
  return out;
}
