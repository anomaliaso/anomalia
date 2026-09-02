/**
 * I modelli che il picker della chat offre: la vetrina, non il magazzino.
 *
 * OpenRouter ne serve 421, di cui 227 sanno usare i tool e leggere immagini — il minimo perché un
 * turno con gli agenti arrivi in fondo. Duecento voci non sono una scelta, sono un menu che
 * nessuno legge, quindi la vetrina è un elenco corto di modelli di punta più tutto ciò che
 * l'operatore ha messo in `LLM_MODELS`.
 *
 * La vetrina dichiara solo gli ID. Nome, prezzo, finestra di contesto e capacità arrivano vivi da
 * `openrouter-models.ts`: un modello ritirato sparisce dal menu da solo invece di fallire al primo
 * turno, e un prezzo che cambia non resta scritto qui dentro a mentire.
 *
 * Verificati presenti su OpenRouter il 2026-09-02, con tools + visione.
 */
import { llmModels } from '$lib/server/llm';
import { ensureGatewayModels, gatewayModel } from '$lib/server/openrouter-models';

export const FEATURED_CHAT_MODEL_IDS = [
  'anthropic/claude-opus-5',
  'anthropic/claude-sonnet-5',
  'anthropic/claude-haiku-4.5',
  'openai/gpt-5.6-sol',
  'openai/gpt-5.6-terra',
  'openai/gpt-5.6-luna',
  'google/gemini-3.7-flash',
  'google/gemini-3.1-pro-preview',
  'x-ai/grok-4.6',
  'deepseek/deepseek-v4-flash-vision-exp',
  'z-ai/glm-5.3-flash',
  'qwen/qwen3.8-max',
  'qwen/qwen3.8-flash',
  'moonshotai/kimi-k3',
  'meta-llama/llama-4-maverick',
  'mistralai/mistral-large-2512'
] as const;

export type ChatModelChoice = {
  id: string;
  label: string;
  contextLength: number;
  inputUsdPerM: number;
  outputUsdPerM: number;
  reasoning: boolean;
};

/**
 * L'ordine è quello della vetrina, non alfabetico: è una gerarchia editoriale, e i modelli
 * configurati dall'operatore vanno in fondo perché sono un'aggiunta, non una raccomandazione.
 */
export async function chatModelChoices(
  opts: { configured?: string[]; fetchImpl?: typeof fetch; baseUrl?: string } = {}
): Promise<ChatModelChoice[]> {
  await ensureGatewayModels({ fetchImpl: opts.fetchImpl, baseUrl: opts.baseUrl });
  const configured = opts.configured ?? llmModels();
  const ids = [...FEATURED_CHAT_MODEL_IDS, ...configured.filter((id) => !FEATURED_CHAT_MODEL_IDS.includes(id as never))];

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

/** Vero quando quell'id è una scelta che il picker può davvero offrire adesso. */
export async function isOfferedChatModel(id: unknown): Promise<boolean> {
  const v = String(id ?? '').trim();
  if (!v) return false;
  return (await chatModelChoices()).some((c) => c.id === v);
}
