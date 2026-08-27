// La mappa "chi possiede cosa" fra gli agenti della squadra e le superfici del prodotto, in UN
// posto solo e client-safe (job-roster.ts tira dentro supabase-admin e non può entrare in un
// componente). JOB_HOME/AGENT_HOME vanno dall'agente alla pagina, SEGMENT_OWNER dalla pagina
// all'agente: nessuna delle due va ricopiata altrove.
//
// Le chiavi sono quelle di ROSTER_JOBS: agent-owners.test.ts fallisce se le due liste divergono,
// così questa copia client non può invecchiare in silenzio.

/** Chiave di un lavoro del roster (speculare a JobKey in job-roster.ts, ma client-safe). */
export type OwnerJobKey =
  | 'autopilot'
  | 'analytics_review'
  | 'weekly_recap'
  | 'seo'
  | 'geo'
  | 'radar_recap'
  | 'market_refs'
  | 'strategy_review'
  | 'library';

/** Gli agenti della squadra di default — gli stessi id del composer ($lib/server/chat/agents.ts + 'auto'). */
export type TeamAgentId = 'auto' | 'content' | 'ugc' | 'motion' | 'web' | 'analyst';

/**
 * Ogni valore che `agent` può portare come PROPRIETARIO di una routine, Anomalia inclusa: serve a
 * `parseRoutineOwner`, che deve continuare ad accettare le righe `team:auto` già scritte.
 * Per MOSTRARE la squadra si usa TEAM_SPECIALIST_IDS.
 */
export const TEAM_AGENT_IDS: readonly TeamAgentId[] = ['content', 'analyst', 'web', 'ugc', 'motion', 'auto'];

/**
 * La squadra come la si vede: i cinque mestieri, nell'ordine di /agents e della homepage.
 * Anomalia non c'è: non è un mestiere, ed è la strada di minor resistenza (si apre la sua chat e
 * la squadra non la si incontra mai). Resta il coordinatore invisibile — identità dei thread che
 * già ce l'hanno, ripiego di `resolveAgent`, voce dello smistatore — mai una scelta offerta.
 */
export const TEAM_SPECIALIST_IDS: readonly TeamAgentId[] = TEAM_AGENT_IDS.filter((id) => id !== 'auto');

/**
 * UNA ROUTINE HA UN PROPRIETARIO, e il proprietario è un agente — di default o custom. Si scrive
 * nella STESSA colonna `agent` con un prefisso, quindi nessuna migration:
 *
 *   null | 'content' | 'web' | …  → nessun proprietario: il custom agent classico. Il valore nudo
 *                                   resta "chi la esegue", come per tutte le righe già scritte.
 *   'team:<agentId>'             → la routine è dell'agente di default <agentId>.
 *   'custom:<uuid>'              → la routine è di quel custom agent del brand.
 *
 * L'esecutore si deduce dal proprietario (`resolveAgent` toglie `team:`): sta lì e non nei tre call
 * site che leggono la colonna, perché uno dimenticato girerebbe col set pieno in silenzio.
 */
export type RoutineOwner =
  | { kind: 'builtin'; agentId: TeamAgentId }
  | { kind: 'custom'; scheduleId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Il proprietario scritto in `custom_agent_schedules.agent`, o null se la riga non ne ha uno. */
export function parseRoutineOwner(agent: string | null | undefined): RoutineOwner | null {
  const raw = String(agent ?? '').trim();
  if (raw.startsWith('team:')) {
    const id = raw.slice(5) as TeamAgentId;
    return TEAM_AGENT_IDS.includes(id) ? { kind: 'builtin', agentId: id } : null;
  }
  if (raw.startsWith('custom:')) {
    const id = raw.slice(7);
    return UUID_RE.test(id) ? { kind: 'custom', scheduleId: id } : null;
  }
  return null;
}

/** Il valore da scrivere in `agent` per quel proprietario. */
export function routineOwnerKey(owner: RoutineOwner): string {
  return owner.kind === 'builtin' ? `team:${owner.agentId}` : `custom:${owner.scheduleId}`;
}

/**
 * Un nome che suona come UN RUOLO O UNA PERSONA, non come un compito: dare all'Analyst una routine
 * chiamata "Analyst" ricrea a schermo l'ambiguità che questo lavoro toglie.
 * ponytail: lista di parole, non un classificatore. Sbaglia per difetto, e il costo di un falso
 * negativo è un nome brutto, non un guasto.
 */
const ROLE_WORDS = [
  'agent',
  'agente',
  'specialist',
  'specialista',
  'manager',
  'creator',
  'analyst',
  'analista',
  'strategist',
  'stratega',
  'copywriter',
  'designer',
  'editor',
  'assistant',
  'assistente',
  'consultant',
  'consulente',
  'expert',
  'esperto'
];

export function looksLikeARole(name: string): boolean {
  const words = String(name ?? '')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  return words.some((w) => ROLE_WORDS.includes(w));
}

/**
 * I lavori del roster non sono agenti: sono le routine dei sei agenti veri della chat. Il roster
 * (job-roster.ts) verifica a compile-time che ogni JobKey abbia un owner qui.
 */
export const JOB_OWNERS: Record<OwnerJobKey, TeamAgentId> = {
  autopilot: 'content',
  analytics_review: 'analyst',
  weekly_recap: 'analyst',
  radar_recap: 'analyst',
  market_refs: 'analyst',
  strategy_review: 'analyst',
  seo: 'web',
  geo: 'web',
  library: 'web'
};

/** Dove atterra il lavoro di ogni job del roster (path sotto /app/{slug}). '' = overview. */
export const JOB_HOME: Record<OwnerJobKey, string> = {
  autopilot: '/plan',
  analytics_review: '/analytics',
  weekly_recap: '',
  seo: '/seo',
  geo: '/geo',
  radar_recap: '/leads',
  market_refs: '/competitors',
  strategy_review: '/gtm',
  library: '/library'
};

/** Dove atterra il lavoro degli specialisti builtin della chat (non-roster). */
export const AGENT_HOME: Record<string, string> = {
  content: '/plan',
  web: '/web',
  ugc: '/ugc-creator',
  motion: '/motion-video',
  analyst: '/analytics',
  auto: ''
};

/**
 * Primo segmento di rotta → job del roster. Solo le pagine con un proprietario CHIARO: meglio
 * nessun bottone che un "Parla con" che apre l'agente sbagliato.
 */
const SEGMENT_OWNER: Record<string, OwnerJobKey> = {
  radar: 'radar_recap',
  leads: 'radar_recap',
  analytics: 'analytics_review',
  // Strategia e piano editoriale sono lo stesso mestiere a due granularità (vedi ROSTER_JOBS).
  gtm: 'strategy_review',
  strategy: 'strategy_review',
  plan: 'strategy_review',
  // La coda dei contenuti è il prodotto del producer settimanale.
  calendar: 'autopilot',
  content: 'autopilot',
  approvals: 'autopilot',
  publish: 'autopilot',
  seo: 'seo',
  'seo-geo': 'seo',
  keywords: 'seo',
  backlinks: 'seo',
  geo: 'geo',
  citations: 'geo',
  competitors: 'market_refs'
};

/** Il job che possiede il path dato (path completo o primo segmento sotto /app/{slug}). */
export function owningJobForPath(pathname: string, brandBase: string): OwnerJobKey | null {
  const base = brandBase.endsWith('/') ? brandBase.slice(0, -1) : brandBase;
  let rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  rest = rest.replace(/^\//, '').split('?')[0];
  const seg = rest.split('/')[0] ?? '';
  return SEGMENT_OWNER[seg] ?? null;
}

/** I thread minimi che servono per trovare quello persistente dell'agente che possiede un job. */
type ThreadLike = { id: string; agent?: string | null; surface?: string | null };

/**
 * L'href per "parlare con" chi possiede un job: il thread di squadra dell'agente owner
 * (surface='team'), altrimenti il vecchio thread per-job, altrimenti la home del brand.
 */
export function jobThreadHref(
  threads: readonly ThreadLike[],
  brandSlug: string,
  jobKey: OwnerJobKey
): string {
  const t =
    threads.find((th) => th.surface === 'team' && th.agent === JOB_OWNERS[jobKey]) ??
    threads.find((th) => th.agent === `job:${jobKey}`);
  // ponytail: senza thread si apre il composer generico — creare il thread dal client
  // vorrebbe un endpoint nuovo su team-ignition; se serve, si aggiunge lì, non qui.
  return t ? `/app/${brandSlug}/chat/${t.id}` : `/app/${brandSlug}`;
}

/**
 * PRIMA DI ASSUMERE, GUARDA CHI C'È GIÀ. Dalle parole del compito si ricava chi lo copre, e i tool
 * RIFIUTANO di creare un agente nuovo quando qualcuno lo copre: la regola in prosa non aveva retto,
 * e nascevano colleghi che facevano il lavoro del Web Specialist.
 *
 * Deterministico, zero chiamate a un modello: termini, non semantica. Vince chi ne ha di più;
 * pareggio ⇒ null, cioè "scegli tu".
 * ponytail: liste di termini. Sbaglia per DIFETTO, mai spingendo una routine sul mestiere
 * sbagliato; se i falsi negativi danno fastidio, si allungano le liste.
 */
const TRADE_TERMS: Record<Exclude<TeamAgentId, 'auto'>, readonly string[]> = {
  // Il sito e tutto ciò che lo rende trovabile — incluse le AI che lo citano.
  web: [
    'seo', 'geo', 'aeo', 'sge', 'serp', 'citation', 'citations', 'citazione', 'citazioni',
    'sitemap', 'backlink', 'backlinks', 'keyword', 'keywords', 'ranking', 'rankings',
    'indexing', 'indicizzazione', 'crawl', 'blog', 'article', 'articles', 'articolo',
    'articoli', 'website', 'sito', 'landing', 'metadata', 'schema', 'llm', 'llms'
  ],
  // Produrre e programmare quello che esce sui social.
  content: [
    'post', 'posts', 'caption', 'captions', 'didascalia', 'didascalie', 'carousel', 'carosello',
    'caroselli', 'calendar', 'calendario', 'editorial', 'editoriale', 'publishing',
    'pubblicazione', 'pubblicare', 'feed', 'grafica', 'graphic', 'graphics', 'slide', 'slides',
    'hook', 'copy'
  ],
  // Leggere i numeri, il mercato e la strategia.
  analyst: [
    'analytics', 'performance', 'metric', 'metrics', 'metrica', 'metriche', 'kpi', 'report',
    'reporting', 'recap', 'insight', 'insights', 'benchmark', 'lead', 'leads', 'radar',
    'competitor', 'competitors', 'concorrenti', 'strategy', 'strategia', 'gtm', 'funnel',
    'conversion', 'conversione', 'engagement', 'numeri'
  ],
  // Il volto che parla in camera.
  ugc: ['ugc', 'testimonial', 'unboxing', 'creator', 'creators', 'influencer', 'talking'],
  // Il video che si muove da solo.
  motion: ['motion', 'animation', 'animazione', 'animated', 'animato', 'kinetic', 'cinetico', 'remotion']
};

/**
 * L'agente di default il cui mestiere copre questo compito, o null se nessuno lo copre in modo
 * chiaro (o se due se lo contendono alla pari).
 */
export function agentForTask(text: string): Exclude<TeamAgentId, 'auto'> | null {
  const words = new Set(
    String(text ?? '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
  );
  let best: Exclude<TeamAgentId, 'auto'> | null = null;
  let bestScore = 0;
  let tied = false;
  for (const [id, terms] of Object.entries(TRADE_TERMS) as Array<[Exclude<TeamAgentId, 'auto'>, readonly string[]]>) {
    const score = terms.reduce((n, t) => n + (words.has(t) ? 1 : 0), 0);
    if (score > bestScore) {
      best = id;
      bestScore = score;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }
  return tied ? null : best;
}
