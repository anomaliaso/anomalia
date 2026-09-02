/**
 * I modelli che il picker della chat offre: la vetrina, non il magazzino.
 *
 * OpenRouter ne serve 423, di cui 229 sanno usare i tool e leggere immagini — il minimo perche' un
 * turno con gli agenti arrivi in fondo. Duecento voci non sono una scelta, sono un menu che
 * nessuno legge, quindi la vetrina resta corta e la decide `chat-model-catalog.ts`: la tabella,
 * poi `LLM_MODELS`, poi il fallback nel codice.
 *
 * A quella vetrina si aggiunge da se' il modello piu` recente di ogni vendor che gia` ci sta: il
 * cron scrive le righe una volta al giorno, ma il menu non aspetta il cron per mostrarle.
 *
 * La vetrina dichiara solo gli ID. Nome, prezzo, finestra di contesto e capacita` arrivano vivi da
 * `openrouter-models.ts`: un modello ritirato sparisce dal menu da solo invece di fallire al primo
 * turno, e un prezzo che cambia non resta scritto qui dentro a mentire.
 */
import { llmModels } from '$lib/server/llm';
import { ensureGatewayModels, gatewayModel } from '$lib/server/openrouter-models';
import { catalogModelIds, newModelsForCatalog, FALLBACK_CHAT_MODEL_IDS } from '$lib/server/chat-model-catalog';

export type ChatModelChoice = {
  id: string;
  label: string;
  contextLength: number;
  inputUsdPerM: number;
  outputUsdPerM: number;
  reasoning: boolean;
};

async function showcaseIds(configured?: string[]): Promise<string[]> {
  const fromDb = await catalogModelIds().catch(() => []);
  if (fromDb.length) return fromDb;

  const fromEnv = configured ?? llmModels();
  if (fromEnv.length) return fromEnv;

  return FALLBACK_CHAT_MODEL_IDS;
}

/**
 * L'ordine e` quello della vetrina, non alfabetico: e` una gerarchia editoriale. Le uscite nuove
 * vanno in fondo perche' nessuno le ha ancora messe in ordine — arrivano da sole, non consigliate.
 */
export async function chatModelChoices(
  opts: { configured?: string[]; fetchImpl?: typeof fetch; baseUrl?: string } = {}
): Promise<ChatModelChoice[]> {
  await ensureGatewayModels({ fetchImpl: opts.fetchImpl, baseUrl: opts.baseUrl });

  const showcase = await showcaseIds(opts.configured);
  const ids = [...showcase, ...newModelsForCatalog(showcase)];

  const out: ChatModelChoice[] = [];
  for (const id of ids) {
    const model = gatewayModel(id);
    if (!model?.usable) continue;
    out.push({
      id: model.id,
      label: model.label,
      contextLength: model.contextLength,
      inputUsdPerM: model.rate.input,
      outputUsdPerM: model.rate.output,
      reasoning: model.reasoning
    });
  }
  return out;
}

/** Vero quando quell'id e` una scelta che il picker puo` davvero offrire adesso. */
export async function isOfferedChatModel(id: unknown): Promise<boolean> {
  const v = String(id ?? '').trim();
  if (!v) return false;
  return (await chatModelChoices()).some((c) => c.id === v);
}
