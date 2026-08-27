import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import {
  loadBrandWebhook,
  newWebhookSecret,
  validateWebhookUrl,
  WEBHOOK_COLUMNS,
  type BrandWebhookRow
} from '$lib/server/brand-webhooks';
import { loadBrandTriggers, syncBrandTriggers } from '$lib/server/brand-triggers';

/** The secret is returned once, when it is created or rotated, and never again. */
function serialize(row: BrandWebhookRow, secret?: string) {
  return {
    url: row.url,
    events: row.events,
    status: row.status,
    failure_count: row.failure_count,
    last_delivery_at: row.last_delivery_at,
    last_error: row.last_error,
    created_at: row.created_at,
    ...(secret ? { secret } : {})
  };
}

// GET: the brand's endpoint, the triggers feeding it, and its last deliveries.
export const GET: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const webhook = await loadBrandWebhook(supabase, brand.id);
  const [triggers, { data: deliveries }] = await Promise.all([
    loadBrandTriggers(supabase, brand.id),
    supabase
      .from('webhook_deliveries')
      .select('id, event_id, trigger_slug, status, attempts, response_status, error, created_at')
      .eq('brand_id', brand.id)
      .order('created_at', { ascending: false })
      .limit(20)
  ]);

  return json({
    webhook: webhook ? serialize(webhook) : null,
    triggers: triggers.map((t) => ({
      trigger: t.trigger_slug,
      provider: t.toolkit_slug,
      config: t.config
    })),
    deliveries: deliveries ?? []
  });
};

// PUT: set (or update) the endpoint. Body: { url, events?, rotate_secret? }
export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey, user } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  let body: { url?: string; events?: unknown; rotate_secret?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const validated = validateWebhookUrl(String(body.url ?? ''));
  if (!validated.ok) return json({ error: validated.error }, { status: 400 });
  const events = Array.isArray(body.events)
    ? body.events.map((e) => String(e).trim().toUpperCase()).filter(Boolean)
    : [];

  const existing = await loadBrandWebhook(supabase, brand.id);
  const secret = existing && !body.rotate_secret ? null : newWebhookSecret();
  const now = new Date().toISOString();

  const { data, error: writeError } = existing
    ? await supabase
        .from('brand_webhooks')
        .update({
          url: validated.url,
          events,
          // A changed URL starts from a clean slate: the old failures were another endpoint's.
          status: 'active',
          failure_count: 0,
          last_error: null,
          ...(secret ? { secret } : {}),
          updated_at: now
        })
        .eq('id', existing.id)
        .select(WEBHOOK_COLUMNS)
        .single()
    : await supabase
        .from('brand_webhooks')
        .insert({
          brand_id: brand.id,
          url: validated.url,
          secret,
          events,
          created_by: user.id,
          updated_at: now
        })
        .select(WEBHOOK_COLUMNS)
        .single();

  if (writeError || !data) {
    return json({ error: writeError?.message ?? 'Could not save the endpoint' }, { status: 400 });
  }

  // An endpoint is what makes triggers worth having: create the ones the brand's state implies.
  const synced = await syncBrandTriggers(supabase, brand.id).catch((error) => { swallow('sync brand triggers', error); return ({ created: 0, deleted: 0 }); });

  return json({
    webhook: serialize(data as BrandWebhookRow, secret ?? undefined),
    triggers_created: synced.created,
    triggers_deleted: synced.deleted
  });
};

// DELETE: remove the endpoint, and with it every trigger that only existed to feed it.
export const DELETE: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  await supabase.from('brand_webhooks').delete().eq('brand_id', brand.id);
  await syncBrandTriggers(supabase, brand.id).catch((error) => { swallow('sync brand triggers', error); return undefined; });
  return json({ ok: true });
};
