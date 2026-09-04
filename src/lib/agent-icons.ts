// Client-side metadata for the multi-agent chat selector: agent id + Lucide icon.
// Server tool/prompt mapping lives in $lib/server/chat/agents.ts.
// Le icone dicono il MESTIERE, non il reparto: prima seguivano le macro della sidebar (Publish,
// Brand, Grow) e chiedevano all'utente di conoscere la nostra architettura per scegliere.
// `auto` is the neutral default → full tool set (server resolveAgent returns null).
import { Sparkles, PenLine, Video, Clapperboard, Globe, TrendingUp } from '@lucide/svelte';

export type AgentMeta = { id: string; icon: typeof PenLine };

/**
 * Neutral fallback: no hub specialization (full Anomalia). NON è più una scelta offerta —
 * è l'identità di ciò che ESISTE GIÀ: i thread salvati con `agent = null` (in produzione la
 * grande maggioranza) e qualunque id che non si riconosce. Normalizzare su un altro id
 * trasformerebbe una conversazione aperta con l'assistente pieno in una conversazione con uno
 * specialista, cambiandole tool e prompt senza dirlo a nessuno.
 */
export const DEFAULT_AGENT_ID = 'auto';

/**
 * Con chi PARTE una conversazione nuova, ora che Anomalia non è più selezionabile.
 *
 * L'utente incontra la squadra nell'onboarding e sceglie da chi partire; da lì in poi il
 * composer deve comunque proporre qualcuno, e il Content Creator è il mestiere più largo
 * (post, caption, grafiche, calendario, piano editoriale — ed è il proprietario della
 * produzione settimanale). Chi vuole un altro specialista lo cambia in un clic.
 * ponytail: una costante, non l'ultimo agente usato — quello è stato da ricordare per un
 * guadagno che nessuno ha chiesto.
 */
export const NEW_CHAT_AGENT_ID = 'content';

/** Old agent ids → hub agents (threads created before the rename). */
// Tenuta in pari con quella del server (`$lib/server/chat/agents.ts`): un thread aperto mesi fa
// deve riaprirsi sullo stesso specialista da entrambi i lati.
const LEGACY_AGENT_MAP: Record<string, string> = {
  publish: 'content',
  brand: 'content',
  media: 'content',
  grow: 'analyst',
  stratega: 'analyst',
  analisi: 'analyst',
  seo: 'web'
};

export const AGENT_META: AgentMeta[] = [
  { id: 'auto', icon: Sparkles },
  { id: 'content', icon: PenLine },
  { id: 'ugc', icon: Video },
  { id: 'motion', icon: Clapperboard },
  { id: 'web', icon: Globe },
  { id: 'analyst', icon: TrendingUp }
];

/**
 * Le opzioni del picker (composer, campo "A", editor delle routine). Web è a pagamento come
 * l'hub in sidebar.
 *
 * ANOMALIA NON È PIÙ FRA LE SCELTE. Non è un mestiere: è "tutti i tool, nessuna
 * specializzazione", ed era la strada di minor resistenza — si atterrava lì e non si
 * incontrava mai la squadra. Resta però l'identità dei thread che ce l'hanno già, quindi
 * `current` la rimette in lista quando è LEI l'agente selezionato: aprire una conversazione
 * vecchia deve mostrarne il nome, non un picker senza selezione.
 */
export function agentMetaForBrand(webHubEnabled: boolean, current?: string | null): AgentMeta[] {
  return AGENT_META.filter(
    (a) =>
      (a.id !== 'web' || webHubEnabled) &&
      (a.id !== DEFAULT_AGENT_ID || current === DEFAULT_AGENT_ID)
  );
}

/** Normalize a stored / legacy agent id for the UI picker. null/empty → auto. */
export function normalizeAgentId(raw: unknown, fallback = DEFAULT_AGENT_ID): string {
  if (typeof raw !== 'string' || !raw || raw === 'auto') return fallback;
  const mapped = LEGACY_AGENT_MAP[raw] ?? raw;
  return AGENT_META.some((a) => a.id === mapped) ? mapped : fallback;
}
