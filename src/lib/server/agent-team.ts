/**
 * IL TEAM — quali agenti ricorrenti ha senso mettere al lavoro per QUESTO brand.
 *
 * La macchina esiste già tutta: `custom_agent_schedules` tiene nome, prompt, agente del registry,
 * giorni e orari; il cron `/api/v1/custom-agents/tick` gira ogni 5 minuti, apre un thread e fa
 * lavorare l'agente come se glielo avesse chiesto l'utente. Fino a 25 per brand. Quello che mancava
 * è che **nessuno li crea**: bisogna trovare la pagina, immaginarsi il team e scrivere i prompt a
 * mano — cioè esattamente il lavoro che l'utente è venuto qui per non fare.
 *
 * PERCHÉ QUESTO MODULO È CODICE E NON UN PEZZO DI PROMPT. La tentazione è scrivere nel system
 * prompt "proponi un team di agenti" e lasciar fare al modello. Ma "quali agenti hanno senso" non è
 * una domanda creativa: dipende da fatti verificabili — il piano permette di pubblicare? c'è un
 * blog? ci sono account collegati? esistono già dati di performance da leggere? Un modello che
 * indovina propone l'agente SEO a chi non ha un sito e l'agente di review analytics a chi non ha
 * mai pubblicato, e l'utente si ritrova un team che gira a vuoto ogni settimana spendendo crediti.
 * Qui la selezione è deterministica; al modello resta la parte in cui è bravo davvero: scrivere il
 * prompt di ciascun agente nella lingua e nel contesto di questo brand, e decidere col cliente
 * quali tenere.
 *
 * Puro: nessuna I/O, nessun clock.
 */

/** Gli agenti del registry chat su cui un incarico ricorrente può girare (vedi chat/agents.ts). */
export type TeamAgentId = 'publish' | 'brand' | 'grow' | 'web';

export type TeamArchetype = {
  /** Chiave stabile: ci si fanno le query e i test, non è testo da mostrare. */
  key: string;
  /** Nome proposto, che l'agente può riscrivere nella lingua del brand. */
  name: { it: string; en: string };
  /** Su quale specialista del registry gira. */
  agent: TeamAgentId;
  /** Cosa fa, in una riga: è quello che l'utente legge per decidere se lo vuole. */
  purpose: { it: string; en: string };
  /** Il brief da cui il modello scrive il prompt vero, in questo brand e in questa lingua. */
  promptSeed: string;
  /** Giorni consigliati (0 = domenica, come nextScheduleRun). */
  daysOfWeek: number[];
  /** Orari consigliati, HH:MM nel fuso del brand. */
  times: string[];
  /**
   * Perché NON proporlo. Un archetipo senza precondizione è un archetipo che qualcuno riceverà a
   * sproposito: ogni voce qui deve saper dire a chi non serve.
   */
  requires: (f: TeamFacts) => boolean;
};

export type TeamFacts = {
  /** Il piano consente di collegare account e pubblicare. */
  canPublish: boolean;
  /** Account social attivi collegati adesso. */
  connectedAccounts: number;
  /** Il brand ha un sito noto (serve a SEO/GEO/blog). */
  hasWebsite: boolean;
  /** Il blog è configurato per questo brand. */
  hasBlog: boolean;
  /** Esistono dati di performance PROPRI da cui un agente possa leggere qualcosa. */
  hasOwnPerformanceData: boolean;
  /** Un piano editoriale attivo: senza, "produci la settimana" non ha una settimana da produrre. */
  hasEditorialPlan: boolean;
  /** Concorrenti censiti: senza, un agente di watch non sa chi guardare. */
  competitors: number;
};

/**
 * Gli archetipi, in ordine di quanto tengono vivo il ciclo pubblica → misura → adatta. L'ordine è
 * la priorità con cui vengono proposti: chi ne attiva solo due deve ricevere i due che contano.
 */
export const TEAM_ARCHETYPES: TeamArchetype[] = [
  {
    key: 'approvals_shepherd',
    name: { it: 'Sveglia approvazioni', en: 'Approvals nudge' },
    agent: 'publish',
    purpose: {
      it: 'Ogni lunedì controlla la coda: se ci sono post fermi, li riassume in due righe e ti dice quali approvare.',
      en: 'Every Monday it checks the queue: if posts are stuck, it summarises them in two lines and tells you which to approve.'
    },
    promptSeed:
      'Leggi i post in attesa di approvazione. Se non ce ne sono, dillo in una riga e fermati. ' +
      'Se ce ne sono, elencali con piattaforma, data prevista e la prima riga della caption, segnala quelli che ti sembrano deboli o fuori voce e proponi la correzione. Non approvare nulla da solo.',
    daysOfWeek: [1],
    times: ['09:00'],
    // La coda esiste solo se il brand produce e pubblica: senza piano editoriale non c'è produzione
    // ricorrente da smaltire.
    requires: (f) => f.hasEditorialPlan
  },
  {
    key: 'performance_reader',
    name: { it: 'Lettura performance', en: 'Performance read' },
    agent: 'grow',
    purpose: {
      it: 'Ogni lunedì legge i numeri della settimana e dice cosa ha funzionato, cosa no e cosa cambiare.',
      en: 'Every Monday it reads the week’s numbers and says what worked, what did not, and what to change.'
    },
    promptSeed:
      'Leggi la performance degli ultimi 7 giorni contro i 7 precedenti. Di’ cosa ha funzionato e cosa no, ' +
      'distinguendo sempre la reach dall’azione. Se il campione non regge una conclusione, dillo invece di inventare un vincitore. ' +
      'Chiudi con una sola cosa da cambiare la settimana prossima.',
    daysOfWeek: [1],
    times: ['10:00'],
    // Senza dati propri leggerebbe il vuoto (o, peggio, i competitor scrapati).
    requires: (f) => f.hasOwnPerformanceData
  },
  {
    key: 'field_watch',
    name: { it: 'Osservatorio di campo', en: 'Field watch' },
    agent: 'grow',
    purpose: {
      it: 'Due volte a settimana guarda cosa sta girando nel tuo campo e cosa possiamo rifare.',
      en: 'Twice a week it looks at what is working in your field and what we can reuse.'
    },
    promptSeed:
      'Guarda cosa sta ottenendo attenzione nel campo di questo brand e nei competitor censiti. ' +
      'Per ogni cosa che gira, di’ COSA l’ha fatta girare (la struttura, l’apertura, la leva) — non l’argomento. ' +
      'Chiudi con una o due mosse concrete che possiamo rifare questa settimana, e con cosa invece non ci somiglia.',
    daysOfWeek: [2, 5],
    times: ['08:00'],
    requires: (f) => f.competitors > 0 || f.hasWebsite
  },
  {
    key: 'week_producer',
    name: { it: 'Produzione settimanale', en: 'Weekly production' },
    agent: 'publish',
    purpose: {
      it: 'Ogni giovedì prepara i contenuti della settimana seguente, così il lunedì trovi la coda pronta.',
      en: 'Every Thursday it prepares next week’s content, so Monday starts with the queue ready.'
    },
    promptSeed:
      'Prepara i contenuti della settimana seguente seguendo il piano editoriale attivo. ' +
      'Rispetta voce, cadenza e mix del piano. Lasciali in attesa di approvazione e riassumi in tre righe cosa hai preparato e perché.',
    daysOfWeek: [4],
    times: ['07:00'],
    requires: (f) => f.hasEditorialPlan
  },
  {
    key: 'seo_gardener',
    name: { it: 'Manutenzione SEO', en: 'SEO upkeep' },
    agent: 'web',
    purpose: {
      it: 'Ogni martedì controlla visibilità, keyword e contenuti del sito, e propone il prossimo intervento.',
      en: 'Every Tuesday it checks visibility, keywords and site content, and proposes the next fix.'
    },
    promptSeed:
      'Controlla lo stato SEO e GEO del sito: cosa si è mosso, dove stiamo perdendo, quali pagine meritano un intervento. ' +
      'Proponi UNA cosa da fare, quella con il rapporto impatto/sforzo migliore, e spiega perché quella e non un’altra.',
    daysOfWeek: [2],
    times: ['09:00'],
    requires: (f) => f.hasWebsite
  },
  {
    key: 'blog_editor',
    name: { it: 'Redazione blog', en: 'Blog desk' },
    agent: 'web',
    purpose: {
      it: 'Ogni mercoledì propone il prossimo articolo, partendo da cosa cercano le persone.',
      en: 'Every Wednesday it proposes the next article, starting from what people actually search.'
    },
    promptSeed:
      'Proponi il prossimo articolo del blog partendo dalle keyword e dalle domande reali del settore, non da un tema generico. ' +
      'Di’ a chi parla, che problema risolve e con quale angolo diverso da quello che c’è già online. Lascialo in bozza.',
    daysOfWeek: [3],
    times: ['08:00'],
    requires: (f) => f.hasBlog
  },
  {
    key: 'brand_memory',
    name: { it: 'Custode del brand', en: 'Brand keeper' },
    agent: 'brand',
    purpose: {
      it: 'Ogni venerdì rilegge cosa è cambiato nel brand e aggiorna quello che l’AI ricorda di te.',
      en: 'Every Friday it reviews what changed about the brand and updates what the AI remembers about you.'
    },
    promptSeed:
      'Rileggi cosa è cambiato questa settimana: nuovi prodotti, nuove pagine, cose dette in chat, materiali caricati. ' +
      'Aggiorna la memoria del brand con quello che vale la pena ricordare per i contenuti futuri, e segnala cosa nel brand kit è ormai vecchio.',
    daysOfWeek: [5],
    times: ['16:00'],
    // Prima di avere un piano editoriale non c'è ancora abbastanza vita del brand da custodire.
    requires: (f) => f.hasEditorialPlan
  }
];

export type TeamProposal = {
  archetype: TeamArchetype;
  /** Perché è stato proposto a questo brand: finisce nella risposta del tool. */
  because: string;
};

/**
 * Il team che ha senso proporre a questo brand, e nient'altro.
 *
 * `canPublish === false` (free/trial e Go) non toglie gli agenti di produzione: quei brand
 * preparano ed esportano, quindi la coda e la settimana servono lo stesso. Toglie solo la premessa
 * che qualcosa esca da solo — che è un problema di messaggio, non di team.
 */
export function proposeTeam(facts: TeamFacts, opts?: { limit?: number }): TeamProposal[] {
  const out: TeamProposal[] = [];
  for (const a of TEAM_ARCHETYPES) {
    if (!a.requires(facts)) continue;
    out.push({ archetype: a, because: whyProposed(a.key, facts) });
  }
  const limit = opts?.limit;
  return typeof limit === 'number' && limit > 0 ? out.slice(0, limit) : out;
}

/** Quelli che NON proponiamo, con il motivo: è l'altra metà di una proposta onesta. */
export function skippedTeam(facts: TeamFacts): Array<{ key: string; why: string }> {
  return TEAM_ARCHETYPES.filter((a) => !a.requires(facts)).map((a) => ({
    key: a.key,
    why: whySkipped(a.key, facts)
  }));
}

function whyProposed(key: string, f: TeamFacts): string {
  switch (key) {
    case 'approvals_shepherd':
      return f.connectedAccounts > 0
        ? 'la coda di approvazione è il punto in cui il contenuto si ferma più spesso'
        : 'i post prodotti vanno comunque rivisti prima di essere esportati';
    case 'performance_reader':
      return 'ci sono dati di performance propri da leggere';
    case 'field_watch':
      return f.competitors > 0 ? `${f.competitors} competitor censiti da tenere d'occhio` : 'il campo del brand è definito dal sito';
    case 'week_producer':
      return 'esiste un piano editoriale attivo da eseguire';
    case 'seo_gardener':
      return 'il brand ha un sito su cui la visibilità organica si accumula';
    case 'blog_editor':
      return 'il blog è configurato';
    case 'brand_memory':
      return 'il brand cambia, e quello che l’AI ricorda deve cambiare con lui';
    default:
      return '';
  }
}

function whySkipped(key: string, f: TeamFacts): string {
  switch (key) {
    case 'approvals_shepherd':
    case 'week_producer':
    case 'brand_memory':
      return 'nessun piano editoriale attivo: prima il piano, poi gli agenti che lo eseguono';
    case 'performance_reader':
      return 'nessun dato di performance proprio: leggerebbe il vuoto ogni settimana';
    case 'field_watch':
      return 'né competitor censiti né sito: non saprebbe dove guardare';
    case 'seo_gardener':
      return 'nessun sito noto per questo brand';
    case 'blog_editor':
      return 'blog non configurato';
    default:
      return f.canPublish ? '' : 'non applicabile a questo piano';
  }
}
