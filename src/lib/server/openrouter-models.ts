/**
 * Il listino del gateway, chiesto al gateway.
 *
 * `RATES` in ai-log.ts è scritto a mano, modello per modello: regge finché i modelli li scegliamo
 * noi, e smette di reggere il giorno in cui li sceglie l'utente. Un modello assente non costa
 * "prudentemente null": costa **zero crediti**, e il conto lo paghiamo comunque.
 *
 * OpenRouter pubblica prezzo, finestra di contesto e capacità di ogni modello su `/models`. Da qui
 * arrivano due cose che prima non c'erano:
 *   · il prezzo per i turni che NON passano dall'AI SDK — l'harness della chat ha il suo client
 *     HTTP e `usage.cost` non lo vediamo (v. llm-usage-cost.ts, che copre tutto il resto);
 *   · l'elenco che il picker mostra, senza un secondo posto dove un modello nuovo va aggiunto.
 *
 * La cache è in memoria e per processo: un listino vecchio di qualche ora non ha mai fatto danni,
 * una chiamata di rete dentro `computeCostUsd` sì.
 */
import { env } from '$env/dynamic/private';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TRANSPORT_PREFIX = /^(?:openrouter|llm)\//;

export type GatewayRate = { input: number; cachedInput: number; output: number };

export type GatewayModel = {
  id: string;
  label: string;
  contextLength: number;
  rate: GatewayRate;
  /** Gli agenti chiamano tool e leggono immagini: senza, il turno muore a metà. */
  usable: boolean;
  reasoning: boolean;
  /** Quando il gateway ha pubblicato il modello: e` cosi` che il cron riconosce l'ultimo uscito. */
  created: number;
};

let models = new Map<string, GatewayModel>();
let loadedAt = 0;
let inFlight: Promise<void> | null = null;

/** Solo per i test: il modulo tiene stato di processo apposta. */
export function __resetGatewayModels(): void {
  models = new Map();
  loadedAt = 0;
  inFlight = null;
}

const perMillion = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n * 1e6 : 0;
};

type RawModel = {
  id?: string;
  name?: string;
  context_length?: number;
  created?: number;
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
  pricing?: Record<string, unknown>;
};

export async function ensureGatewayModels(opts: { fetchImpl?: typeof fetch; baseUrl?: string } = {}): Promise<void> {
  if (models.size && Date.now() - loadedAt < CACHE_TTL_MS) return;
  if (inFlight) return inFlight;
  const doFetch = opts.fetchImpl ?? fetch;
  const baseUrl = (opts.baseUrl ?? env.LLM_BASE_URL?.trim() ?? '').replace(/\/$/, '');
  if (!baseUrl) return;

  inFlight = (async () => {
    try {
      const res = await doFetch(`${baseUrl}/models`);
      if (!res.ok) return;
      const body = (await res.json()) as { data?: RawModel[] };
      const next = new Map<string, GatewayModel>();
      for (const m of body?.data ?? []) {
        if (!m?.id) continue;
        const params = m.supported_parameters ?? [];
        next.set(m.id, {
          id: m.id,
          label: m.name?.trim() || m.id,
          contextLength: Number(m.context_length) || 0,
          rate: {
            input: perMillion(m.pricing?.prompt),
            cachedInput: perMillion(m.pricing?.input_cache_read ?? m.pricing?.prompt),
            output: perMillion(m.pricing?.completion)
          },
          usable: params.includes('tools') && (m.architecture?.input_modalities ?? []).includes('image'),
          reasoning: params.includes('reasoning'),
          created: Number(m.created) || 0
        });
      }
      if (next.size) {
        models = next;
        loadedAt = Date.now();
      }
    } catch {
      // Un listino irraggiungibile lascia il prezzo alle RATES, come prima di questo modulo.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function gatewayModel(modelId: string | undefined): GatewayModel | null {
  const id = (modelId ?? '').trim().replace(TRANSPORT_PREFIX, '');
  return (id && models.get(id)) || null;
}

/** Null quando il listino non conosce il modello: meglio non misurato che misurato a caso. */
export function gatewayRate(modelId: string | undefined): GatewayRate | null {
  const hit = gatewayModel(modelId);
  if (!hit) return null;
  return hit.rate.input || hit.rate.output ? hit.rate : null;
}

/** Tutti i modelli che il picker può offrire, ordinati per nome. */
export function usableGatewayModels(): GatewayModel[] {
  return [...models.values()].filter((m) => m.usable).sort((a, b) => a.label.localeCompare(b.label));
}
