import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

interface ServiceCheck {
  name: string;
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}

async function timed(name: string, fn: () => Promise<void>): Promise<ServiceCheck> {
  const start = performance.now();
  try {
    await fn();
    return { name, status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (e) {
    return {
      name,
      status: 'error',
      latencyMs: Math.round(performance.now() - start),
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

// Service names are deliberately generic (role, not vendor): this endpoint and /status are public,
// and which provider sits behind each role is not something we advertise.
async function checkSupabase(): Promise<ServiceCheck> {
  return timed('database', async () => {
    const client = createAdminClient();
    const { error } = await client.from('brands').select('id', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
  });
}

// Primary text/structured model — every strategy, plan and caption goes through this key first.
//
// Guardava la chiave DeepSeek, e mentiva in tutti e due i sensi: da quando il lavoro di sfondo è
// tornato su Gemini Flash, una chiave DeepSeek assente marcava "degraded" un provider che non
// scrive più niente, e una chiave a saldo zero restava verde — `/models` risponde 200 anche senza
// credito, che è esattamente il modo in cui quel guasto è rimasto invisibile per ore. Ora controlla
// il modello che il testo lo scrive davvero. Stessa chiave di ai:vision, ruolo diverso: se muore,
// tutte e due sono giù per davvero, ed è giusto che si vedano tutte e due rosse.
async function checkAiText(): Promise<ServiceCheck> {
  return timed('ai:text', async () => {
    const key = env.LLM_API_KEY?.trim();
    if (!key) throw new Error('text model API key not set');
    const base = (env.LLM_BASE_URL?.trim() || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    const res = await fetch(`${base}/models`, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000)
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new Error('API key invalid or rejected');
    if (res.status >= 500) throw new Error(`text model API returned ${res.status}`);
  });
}

// Pixel generation (Kie images) — not the text gateway.
async function checkAiVision(): Promise<ServiceCheck> {
  return timed('ai:vision', async () => {
    const key = env.KIE_API_KEY?.trim();
    if (!key) throw new Error('image/video API key not set');
  });
}

async function checkZernio(): Promise<ServiceCheck> {
  return timed('social:publishing', async () => {
    const key = env.ZERNIO_API_KEY;
    if (!key) throw new Error('publishing API key not set');
    // Ping the profiles endpoint (HEAD-style: we just need a non-5xx response)
    const res = await fetch('https://zernio.com/api/v1/profiles', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000)
    });
    if (res.status >= 500) throw new Error(`publishing API returned ${res.status}`);
  });
}

export const GET: RequestHandler = async ({ url }) => {
  const origin = url.origin;
  const endpointChecks = [
    timed('api:locale', async () => {
      const res = await fetch(`${origin}/api/v1/locale`, { method: 'GET', signal: AbortSignal.timeout(10_000) });
      if (res.status >= 500) throw new Error(`Returned ${res.status}`);
    }),
    timed('api:brands', async () => {
      const res = await fetch(`${origin}/api/v1/brands`, { method: 'GET', signal: AbortSignal.timeout(10_000) });
      if (res.status >= 500) throw new Error(`Returned ${res.status}`);
    }),
  ];

  const [database, aiText, aiVision, publishing, ...endpoints] = await Promise.all([
    checkSupabase(),
    checkAiText(),
    checkAiVision(),
    checkZernio(),
    ...endpointChecks
  ]);

  const services = [database, aiText, aiVision, publishing, ...endpoints];
  const errorCount = services.filter((s) => s.status === 'error').length;
  const status = errorCount === 0 ? 'ok' : errorCount >= 2 ? 'critical' : 'degraded';

  return json(
    {
      status,
      timestamp: new Date().toISOString(),
      services
    },
    { status: errorCount >= 2 ? 503 : 200 }
  );
};
