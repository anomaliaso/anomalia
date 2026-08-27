import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import crypto from 'node:crypto';
import { trackingAllowed } from '$lib/analytics';
import { isInternalEmail } from './internal-users';

// Same pixel the browser uses (see $lib/analytics loadMetaPixel). The browser only ever sent
// PageView (app) + InitiateCheckout (Stripe's hosted checkout) — Purchase was never tracked, so
// sales campaigns were optimising on a soft mid-funnel proxy. This sends the missing bottom-funnel
// event server-side via the Conversions API, which survives Safari/iOS ITP and adblockers.
// Stesso pixel del browser, e come lì niente default cablato: senza PUBLIC_META_PIXEL_ID
// non si manda niente (vedi $lib/analytics).
const pixelId = () => publicEnv.PUBLIC_META_PIXEL_ID?.trim() || '';
const GRAPH = 'https://graph.facebook.com/v21.0';

const sha256 = (s: string) => crypto.createHash('sha256').update(s.trim().toLowerCase()).digest('hex');

/** Hostname da una URL, '' se non è una URL. */
function hostOf(url: string | null | undefined): string {
  try {
    return new URL(url ?? '').hostname;
  } catch {
    return '';
  }
}

/**
 * Fire a server-side conversion event to Meta. Best-effort: it never throws into the request path,
 * and it no-ops when META_CAPI_TOKEN (a pixel Conversions API access token, from Events Manager) is
 * unset. Pass a stable `eventId` so re-entries — or the matching browser pixel event with the same
 * eventID — dedup into one conversion. `value`/`currency` are optional (only Purchase needs them).
 * ponytail: server-only by design. That's the point (no ITP/adblock loss); don't "simplify" it to a
 * client-only fbq('track') — that's exactly the fragile signal this backs up.
 */
export async function metaCapiEvent(
  eventName: string,
  opts: {
    eventId: string;
    value?: number | null;
    currency?: string | null;
    email?: string | null;
    fbp?: string | null;
    fbc?: string | null;
    clientIp?: string | null;
    userAgent?: string | null;
    eventSourceUrl?: string | null;
  }
): Promise<void> {
  const token = env.META_CAPI_TOKEN;
  if (!token || !pixelId()) return;

  // Gli stessi due guard del browser, perché questa metà parte dal server e un guard solo lato
  // client sarebbe cosmetico: un preview o un `vercel dev` non deve mandare conversioni al pixel
  // vero, e una registrazione fatta da noi non è una conversione. L'host lo dà l'evento stesso
  // (`eventSourceUrl`, sempre passato dai chiamanti); PUBLIC_APP_URL è la rete di sicurezza.
  if (!trackingAllowed(hostOf(opts.eventSourceUrl) || hostOf(publicEnv.PUBLIC_APP_URL))) return;
  if (isInternalEmail(opts.email)) return;

  const user_data: Record<string, unknown> = {};
  if (opts.email) user_data.em = [sha256(opts.email)];
  if (opts.fbp) user_data.fbp = opts.fbp;
  if (opts.fbc) user_data.fbc = opts.fbc;
  if (opts.clientIp) user_data.client_ip_address = opts.clientIp;
  if (opts.userAgent) user_data.client_user_agent = opts.userAgent;

  const body = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: opts.eventId,
        action_source: 'website',
        ...(opts.eventSourceUrl ? { event_source_url: opts.eventSourceUrl } : {}),
        user_data,
        ...(opts.value != null ? { custom_data: { value: opts.value, currency: opts.currency ?? 'EUR' } } : {})
      }
    ]
  };

  try {
    const res = await fetch(`${GRAPH}/${pixelId()}/events?access_token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) console.error(`meta-capi ${eventName} failed`, res.status, await res.text());
  } catch (e) {
    console.error(`meta-capi ${eventName} error`, e); // tracking must never break the request path
  }
}

/** Purchase is the bottom-funnel money event — the value/currency are what the customer just paid. */
export async function metaCapiPurchase(opts: {
  eventId: string;
  value: number;
  currency: string;
  email?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  eventSourceUrl?: string | null;
}): Promise<void> {
  return metaCapiEvent('Purchase', opts);
}
