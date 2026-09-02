/**
 * Chi decide quali modelli il picker offre — e in che ordine.
 *
 * Tre sorgenti, in questo ordine e senza mescolarle: la tabella `chat_model_catalog`, poi
 * `LLM_MODELS` nell'env, poi la lista nel codice. La prima che ha qualcosa vince tutta: un menu
 * meta` database e meta` env sarebbe un menu che nessuno sa spiegare.
 *
 * Il codice resta ultimo perche' e' l'unico posto che non si puo` cambiare senza un deploy: serve
 * a far partire un'istanza appena installata, non a governare quella che gira.
 */
import { createAdminClient } from '$lib/server/supabase-admin';
import { usableGatewayModels, type GatewayModel } from '$lib/server/openrouter-models';

const CACHE_TTL_MS = 60 * 1000;

/** L'ultima spiaggia: nessuna riga, nessun env. Le stesse righe che la migration semina. */
export const FALLBACK_CHAT_MODEL_IDS = [
  'anthropic/claude-opus-5',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-haiku-4.5',
  'openai/gpt-5.6-sol',
  'google/gemini-3.7-flash',
  'x-ai/grok-4.6',
  'deepseek/deepseek-v4-flash-vision-exp',
  'z-ai/glm-5.3-flash'
];

let cached: string[] | null = null;
let loadedAt = 0;

/** Solo per i test: il modulo tiene stato di processo apposta. */
export function __resetChatModelCatalog(): void {
  cached = null;
  loadedAt = 0;
}

type CatalogRow = { model_id: string; position: number };

/** Gli id in vetrina secondo il database. Vuoto quando la tabella non c'e` o non ha righe. */
export async function catalogModelIds(): Promise<string[]> {
  if (cached && Date.now() - loadedAt < CACHE_TTL_MS) return cached;

  const { data, error } = await createAdminClient()
    .from('chat_model_catalog')
    .select('model_id, position')
    .eq('enabled', true)
    .order('position', { ascending: true })
    .order('model_id', { ascending: true });

  if (error) return cached ?? [];

  cached = ((data ?? []) as CatalogRow[]).map((r) => r.model_id);
  loadedAt = Date.now();
  return cached;
}

const vendorOf = (id: string) => id.split('/')[0] ?? '';

/** `:batch`, `:free`, `~vendor/...`: varianti dello stesso modello, non modelli nuovi. */
const isVariant = (id: string) => id.includes(':') || id.startsWith('~');

const newestFirst = (a: GatewayModel, b: GatewayModel) => b.created - a.created;

/**
 * I modelli che il cron aggiungerebbe adesso: per ogni vendor gia` presente in vetrina, il piu`
 * recente che il gateway serve, se non c'e` gia`.
 *
 * Il vendor lo decide la tabella, non una lista in questo file: seguire OpenAI e non seguire
 * Sakana e` una scelta editoriale, e sta dove l'operatore la puo` cambiare.
 */
export function newModelsForCatalog(known: string[]): string[] {
  const followed = new Set(known.map(vendorOf));
  const byVendor = new Map<string, GatewayModel>();

  for (const model of usableGatewayModels()) {
    if (isVariant(model.id)) continue;

    const vendor = vendorOf(model.id);
    if (!followed.has(vendor)) continue;

    const best = byVendor.get(vendor);
    if (!best || newestFirst(best, model) > 0) byVendor.set(vendor, model);
  }

  const owned = new Set(known);
  return [...byVendor.values()].filter((m) => !owned.has(m.id)).sort(newestFirst).map((m) => m.id);
}
