/** Curated chat commands shown in the composer dropdown (user-facing actions). */
export type ChatCommand = {
  id: string;
  /** Optional tool name to hint the model this turn */
  tool?: string;
  group: 'goal' | 'content' | 'strategy' | 'seo' | 'blog' | 'brand';
  /** Il token che si scrive dopo lo slash, quello che il menu inline filtra. Corto e in inglese:
   * uno slash command si batte, non si legge. */
  slash: string;
  /**
   * `prompt` (default) inserisce un testo pronto nella casella: il modello riceve una frase normale.
   * `command` resta scritto com'è e lo interpreta il server. Restano pochi apposta — ogni comando
   * vero è una regola in più che deve valere su OGNI superficie (browser, CLI, coda).
   */
  kind?: 'prompt' | 'command';
};

export const CHAT_COMMANDS: ChatCommand[] = [
  // I due comandi veri, e sono tutti e due sulla conversazione stessa:
  // `/goal <cosa deve essere vero>` fissa l'obiettivo, `/clear` azzera la memoria dell'agente.
  { id: 'goal', slash: 'goal', group: 'goal', kind: 'command' },
  { id: 'clear', slash: 'clear', group: 'goal', kind: 'command' },
  { id: 'createPost', tool: 'create_post', slash: 'post', group: 'content' },
  { id: 'generateImage', tool: 'generate_image', slash: 'image', group: 'content' },
  { id: 'produceWeek', tool: 'produce_week', slash: 'week', group: 'content' },
  { id: 'createCampaign', tool: 'create_campaign', slash: 'campaign', group: 'content' },
  { id: 'generateStrategy', tool: 'generate_strategy', slash: 'strategy', group: 'strategy' },
  { id: 'generatePlan', tool: 'generate_editorial_plan', slash: 'plan', group: 'strategy' },
  { id: 'setupChecklist', tool: 'show_setup_checklist', slash: 'setup', group: 'strategy' },
  { id: 'seoAudit', tool: 'run_seo_geo_audit', slash: 'seo', group: 'seo' },
  { id: 'seoPlan', tool: 'generate_seo_plan', slash: 'seo-plan', group: 'seo' },
  { id: 'writeArticle', tool: 'write_planned_article', slash: 'article', group: 'blog' },
  { id: 'generatePerson', tool: 'generate_person', slash: 'person', group: 'brand' },
  { id: 'reanalyzeBrand', tool: 'reanalyze_brand', slash: 'reanalyze', group: 'brand' },
  { id: 'offerUpgrade', tool: 'offer_upgrade', slash: 'upgrade', group: 'brand' }
];

export const CHAT_COMMAND_GROUPS: Array<ChatCommand['group']> = [
  'goal',
  'content',
  'strategy',
  'seo',
  'blog',
  'brand'
];

/**
 * Quello che si sta scrivendo è l'inizio di uno slash command? Vero solo mentre la casella contiene
 * SOLTANTO il comando: uno slash a metà frase è una data, un percorso o una barra. Torna la query
 * (senza slash), o `null`.
 */
export function slashQuery(value: string): string | null {
  if (!value.startsWith('/')) return null;
  const body = value.slice(1);
  // Appena il comando è completo e si scrive l'argomento (`/goal tutti i post…`) il menu si chiude:
  // ha già fatto il suo lavoro.
  if (/[\s\n]/.test(body)) return null;
  if (body.length > 24) return null;
  return body.toLowerCase();
}

/**
 * `/clear` — l'agente riparte da zero, la conversazione resta intera: NON cancella niente, sposta
 * in avanti lo stesso confine della compattazione (`chat_threads.summary_upto`), quindi i turni di
 * prima restano scorrevoli e ricercabili, fuori dalla finestra del modello. È l'opposto del cestino
 * della chat (`action: 'clear'`, che cancella le righe).
 * Il parsing sta qui per la stessa ragione di `/goal`: lo fanno in due, il client per non spendere
 * un turno e il server perché un comando che vale solo nel browser non è un comando. Nessun
 * argomento: `/clear i post di ieri` è un messaggio normale.
 */
export const CLEAR_COMMAND_ALIASES = ['/clear', '/pulisci'] as const;

export function isClearCommand(text: string | null | undefined): boolean {
  const raw = String(text ?? '').trim().toLowerCase();
  return (CLEAR_COMMAND_ALIASES as readonly string[]).includes(raw);
}

/**
 * La riga che resta nella trascrizione quando il contesto viene azzerato: senza, l'agente
 * "dimenticherebbe" a metà conversazione e chi riapre il thread da un'altra scheda vedrebbe solo
 * un'AI impazzita. La scrive il server e arriva alle altre sessioni col push dei messaggi.
 */
export function clearContextNotice(en: boolean): string {
  return en
    ? "🧹 **Context cleared.** From here on I can't see the messages above — they all stay in this conversation, scrollable and searchable."
    : '🧹 **Contesto azzerato.** Da qui in poi non vedo i messaggi sopra — restano tutti in questa conversazione, scorrevoli e ricercabili.';
}

/** Il rifiuto, quando sul thread c'è ancora un turno che sta girando o è in coda. */
export function clearBusyNotice(en: boolean): string {
  return en
    ? '🧹 **Context not cleared:** a turn is still running (or queued) on this thread, and it would resume reading a history that no longer exists. Ask again when it has finished.'
    : '🧹 **Contesto non azzerato:** su questo thread c\'è ancora un turno che gira (o in coda), e riprenderebbe leggendo una storia che non c\'è più. Richiedilo quando ha finito.';
}

/** I comandi che corrispondono a quello che si sta scrivendo, in ordine di menu. */
export function matchCommands(query: string, commands: ChatCommand[] = CHAT_COMMANDS): ChatCommand[] {
  if (!query) return commands;
  const q = query.toLowerCase();
  return commands.filter((c) => c.slash.includes(q) || c.id.toLowerCase().includes(q));
}
