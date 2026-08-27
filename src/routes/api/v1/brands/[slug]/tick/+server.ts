import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  // An autopilot run spends AI credits (produce/GTM/plan/render) — gate it like the other
  // AI-spending CLI actions so a brand member with a JWT can't drain the org's credits.
  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  // The inner autopilot tick only accepts the cron secret (Bearer $CRON_SECRET or
  // X-Autopilot-Secret), never a CLI bearer — forwarding the CLI token 401s forever. Authenticate
  // internally with the server secret instead; the CLI's own ownership check already ran above.
  const secret = env.AUTOPILOT_SECRET ?? env.CRON_SECRET;
  if (!secret) {
    return json(
      { error: 'Autopilot tick is not configured: AUTOPILOT_SECRET (or CRON_SECRET) env var is missing.' },
      { status: 503 }
    );
  }

  // Call the existing autopilot tick endpoint with the brand ID
  const tickUrl = new URL('/api/v1/autopilot/tick', request.url);
  const tickResponse = await fetch(tickUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-autopilot-secret': secret,
    },
    body: JSON.stringify({ brand_id: brand.id }),
  });

  if (!tickResponse.ok) {
    const text = await tickResponse.text();
    return json({ error: `Tick failed: ${text}` }, { status: tickResponse.status });
  }

  const data = await tickResponse.json();
  return json(data);
};
