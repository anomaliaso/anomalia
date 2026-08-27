import type { RequestHandler } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import {
  brandIdFromComposioUser,
  composioWebhookSecret,
  parseComposioTriggerEvent,
  verifyComposioWebhook
} from '$lib/server/composio';
import {
  attemptDelivery,
  enqueueDelivery,
  loadBrandWebhook,
  wantsEvent
} from '$lib/server/brand-webhooks';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~30s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 30 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

type Platform = { context?: { waitUntil?: (p: Promise<unknown>) => void } } | undefined;

/**
 * Composio's single ingress for this project: every brand's trigger events land here, and we
 * fan them out to each brand's own endpoint. Answer fast — Composio retries on a slow handler,
 * and a duplicate event is only harmless because the delivery table refuses to store it twice.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
  const host = platform as Platform;
  const secret = composioWebhookSecret();
  if (!secret) return new Response('Webhooks are not configured', { status: 503 });

  const raw = await request.text();
  const verified = verifyComposioWebhook({
    rawBody: raw,
    webhookId: request.headers.get('webhook-id'),
    webhookTimestamp: request.headers.get('webhook-timestamp'),
    signatureHeader: request.headers.get('webhook-signature'),
    secret
  });
  if (!verified) return new Response('Invalid signature', { status: 401 });

  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const event = parseComposioTriggerEvent(payload);
  if (!event) return json({ ok: true, skipped: 'not-a-trigger-event' });

  const brandId = brandIdFromComposioUser(event.userId);
  if (!brandId) return json({ ok: true, skipped: 'unknown-user' });

  const admin = createAdminClient();
  const webhook = await loadBrandWebhook(admin, brandId);
  if (!webhook || webhook.status === 'paused') return json({ ok: true, skipped: 'no-endpoint' });
  if (!wantsEvent(webhook, event.triggerSlug)) return json({ ok: true, skipped: 'not-subscribed' });

  const delivery = await enqueueDelivery(admin, { brandId, webhookId: webhook.id, event });
  // Already seen: Composio is retrying an event we accepted. Nothing more to do.
  if (!delivery) return json({ ok: true, duplicate: true });

  const send = attemptDelivery(admin, delivery, webhook).catch((e) => {
    console.error('[composio/webhook] deliver', e);
    return false;
  });
  // Deliver after answering when the platform allows it; the retry worker covers the rest.
  if (host?.context?.waitUntil) host.context.waitUntil(send);
  else await send;

  return json({ ok: true, delivery_id: delivery.id });
};

function json(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
