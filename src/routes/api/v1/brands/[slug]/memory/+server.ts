import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import {
  loadMemoryEntries,
  writeMemory,
  detectConflict,
  type MemoryCategory
} from '$lib/server/brand-memory';
import {
  AGENT_MEMORY_CATEGORIES,
  MEMORY_CATEGORIES,
  MEMORY_ENTRIES_DEFAULT,
  MEMORY_ENTRIES_MAX,
  type AgentMemoryCategory
} from '@anomalia/api-contracts';

// LA MEMORIA DEL BRAND PER UN AGENTE CHE STA FUORI. `/studio/memory` resta la superficie
// dell'OPERATORE, che dalla sua pagina può scrivere anche voice e constraint; questa è quella
// dell'agente, e ha regole diverse — che è il motivo per cui è una rotta diversa invece di un
// ramo dentro l'altra.
//
// GET  → puro. Leggere non è usare: il contatore lo muove `/memory/used`, dopo aver agito.
// POST → scrive solo ciò che un agente ha imparato lavorando, e non vince mai un conflitto.

/** Confidenza di un fatto dedotto da un modello: sotto quella di una riga scritta a mano (1.0). */
const INFERRED_CONFIDENCE = 0.7;

const isWritable = (value: string): value is AgentMemoryCategory =>
  (AGENT_MEMORY_CATEGORIES as readonly string[]).includes(value);

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const asked = url.searchParams.get('category');
  if (asked && !(MEMORY_CATEGORIES as readonly string[]).includes(asked)) {
    return json({ error: 'unknown_category' }, { status: 400 });
  }

  const requested = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(MEMORY_ENTRIES_MAX, Math.round(requested))
    : MEMORY_ENTRIES_DEFAULT;

  // `agent: null` è il filtro, non l'assenza di uno: la memoria del brand, mai le note di mestiere
  // di un collega. Il layer di sessione lo esclude già `loadMemoryEntries`.
  const entries = await loadMemoryEntries(supabase, brand.id, {
    ...(asked ? { category: asked as MemoryCategory } : {}),
    agent: null
  });

  const page = entries.slice(0, limit);

  return json({
    count: page.length,
    entries: page.map((entry) => ({
      id: entry.id,
      key: entry.key,
      value: entry.value,
      category: entry.category,
      source: entry.source,
      confidence: entry.confidence,
      timesUsed: entry.times_used ?? 0,
      lastUsedAt: entry.last_used_at ?? null,
      pinned: entry.pinned ?? false,
      createdAt: entry.created_at
    }))
  });
};

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = (await request.json()) as { key?: string; value?: string; category?: string };
  const key = body.key?.trim();
  const value = body.value?.trim();

  if (!key || !value || !body.category) {
    return json({ error: 'key, value and category are required' }, { status: 400 });
  }
  if (!isWritable(body.category)) {
    return json({ error: 'category_not_writable' }, { status: 403 });
  }

  // L'ULTIMO ARRIVATO NON VINCE. Un valore che contraddice quello che c'è torna con entrambi e non
  // scrive: se la memoria fosse dell'ultimo scrittore, un modello potrebbe ribaltare in silenzio
  // una cosa che qualcuno aveva messo a mano. Lo stesso valore, invece, è un rinforzo.
  const conflict = await detectConflict(supabase, brand.id, key, value);
  if (conflict) {
    return json({ error: 'memory_conflict', conflict }, { status: 409 });
  }

  try {
    const written = await writeMemory(supabase, brand.id, {
      key,
      value,
      category: body.category,
      source: 'chat',
      confidence: INFERRED_CONFIDENCE
    });
    return json({ ok: true, ...written });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith('skill_limit_reached')) {
      return json({ error: 'skill_limit_reached', detail: message }, { status: 409 });
    }
    throw e;
  }
};
