import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ONBOARDING_CHAT_SURFACE,
  ONBOARDING_SETUP_AGENT,
  buildOnboardingSetupBrief,
  onboardingBriefSection,
  onboardingSeedMessage,
  seedOnboardingChat
} from './onboarding-chat';
import { ROSTER_JOBS, scheduledWorkAllowed } from './job-roster';
import { PLANS } from '$lib/plans';

/**
 * Le tre promesse del setup in chat:
 *   1. il messaggio visibile è una richiesta leggibile scritta per l'utente (l'incarico operativo
 *      resta comunque solo nel brief lato server, mai duplicato nel messaggio);
 *   2. la squadra nel brief viene dal registro (ROSTER_JOBS), non da una lista ricopiata;
 *   3. il ramo pagato/non pagato è legato a scheduledWorkAllowed — la stessa funzione che i tick
 *      consultano — e dal 2026-08-22 il setup non culmina nel paywall ma nelle connessioni app
 *      (propose_app_connection); offer_upgrade resta solo su richiesta dell'utente.
 */

describe('buildOnboardingSetupBrief', () => {
  const base = { brandName: 'Acme', website: 'https://acme.com', locale: 'it' };

  it('presenta la squadra dal registro: ogni lavoro di ROSTER_JOBS è nel prompt', () => {
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    for (const job of ROSTER_JOBS) expect(brief).toContain(job.key);
  });

  it('brand senza piano: il setup NON culmina nel paywall — culmina nelle connessioni; l\'upgrade resta solo su richiesta', () => {
    expect(scheduledWorkAllowed(null)).toBe(false); // il gate resta quello che è
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    // Il passo che ha preso il posto del paywall: chiedi le app e proponi 1–2 connessioni subito.
    expect(brief).toContain('propose_app_connection');
    expect(brief).toContain('CONNECT THEIR APPS');
    expect(brief).toContain('does NOT culminate in a paywall');
    // offer_upgrade resta nel prodotto, ma solo se è l'utente a chiedere di piani/prezzi.
    expect(brief).toContain('offer_upgrade');
    // Prezzi reali da $lib/plans, mai numeri ricopiati che driftano.
    const starter = PLANS.find((p) => p.key === 'starter')!;
    expect(brief).toContain(`€${starter.m}/mo`);
    // E il divieto esplicito di inventare dati misurati.
    expect(brief).toContain('never invent case studies');
  });

  it('brand già pagante: niente pitch, si conferma la squadra attiva — ma le connessioni si propongono comunque', () => {
    expect(scheduledWorkAllowed('starter')).toBe(true);
    const brief = buildOnboardingSetupBrief({ ...base, plan: 'starter' });
    expect(brief).not.toContain('offer_upgrade');
    expect(brief).toContain('already on a paid plan');
    expect(brief).toContain('propose_app_connection');
  });

  it('il criterio app è soddisfacibile anche senza il servizio, e l\'infrastruttura non si racconta mai', () => {
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    // Chiedere e registrare basta: senza questo, in un ambiente senza connessioni il criterio
    // resta sospeso e l'agente spiega all'utente perché la card non c'è.
    expect(brief).toContain('THE MINIMUM FOR THIS CRITERION IS THE ASK, NOT THE CARD');
    expect(brief).toContain('agent_instruction');
    expect(brief).toContain('NEVER EXPLAIN THE PLUMBING');
  });

  // ── La review del 2026-08-22: consulenza, non cronaca ───────────────────────────────────────
  // Ognuno di questi test pinna un difetto visto in un onboarding REALE (brand DeepSeek): sei
  // paragrafi di resoconto in prima persona, quattro numeri senza una raccomandazione, zero idee
  // di contenuto, la squadra raccontata a parole e un solo agente custom SEO a schermo.

  it('vieta la cronaca del processo e impone la brevità: le chip raccontano già cosa è successo', () => {
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    expect(brief).toContain('NEVER NARRATE YOUR PROCESS');
    expect(brief).toContain("I'm checking...");
    expect(brief).toContain('AT MOST 4 SHORT LINES OF TEXT PER TURN');
    expect(brief).toContain('chips');
  });

  it('ogni numero misurato esce con una raccomandazione e una priorità', () => {
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    expect(brief).toContain('EVERY NUMBER COMES WITH A RECOMMENDATION');
    expect(brief).toContain('priority 1, 2 or 3');
    // e l'audit non è più il centro della conversazione: un numero, una raccomandazione.
    expect(brief).toContain('ONE AUDIT, ONE RECOMMENDATION');
  });

  it('almeno 3 idee di contenuto vere, e passano dalla card del banco idee', () => {
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    expect(brief).toContain('THREE REAL IDEAS');
    expect(brief).toContain('save_disruptive_idea');
    // le categorie non sono idee: è esattamente ciò che l'onboarding reale non ha mai superato.
    expect(brief).toContain('are categories, not ideas');
  });

  it('la squadra si MOSTRA (show_team) e il custom agent viene dopo, non al posto suo', () => {
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    expect(brief).toContain('show_team');
    expect(brief).toContain('Only AFTER show_team');
    // l'ordine conta: il tool della squadra è nel brief prima della proposta del custom agent.
    expect(brief.indexOf('show_team')).toBeLessThan(brief.indexOf('propose_custom_agent'));
  });

  it('il lavoro si annuncia prima e si MOSTRA con le card, e non si dichiara senza un tool', () => {
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    expect(brief).toContain('ANNOUNCE BEFORE YOU ACT');
    expect(brief).toContain('NEVER CLAIM WORK THAT A TOOL DID NOT CONFIRM');
    // i post si mostrano con read_posts (che rende le card), mai come elenco di titoli in prosa.
    expect(brief).toContain('read_posts');
    expect(brief).toContain('SHOW THEM THE WORK, DO NOT DESCRIBE IT');
  });

  it('la distribuzione viene prima della SEO/GEO — è quello che il prodotto vende', () => {
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    expect(brief).toContain('Anomalia is DISTRIBUTION');
    expect(brief).toContain('SEO and GEO are ONE lever');
    // idee e produzione arrivano nel brief prima dell'audit tecnico.
    expect(brief.indexOf('THREE REAL IDEAS')).toBeLessThan(brief.indexOf('run_seo_geo_audit'));
  });

  it('i criteri del goal parlano di risultati per l\'utente, non di passi eseguiti', () => {
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    expect(brief).toContain('The criteria describe RESULTS FOR THE USER');
    expect(brief).toContain('they have at least 3 concrete content ideas');
    expect(brief).toContain('they know the team that works for them');
    expect(brief).toContain('they know their number one obstacle');
    expect(brief).toContain("not when you performed the step");
  });

  it('la lingua della risposta segue il locale', () => {
    expect(buildOnboardingSetupBrief({ ...base, locale: 'it', plan: null })).toContain('Italian');
    expect(buildOnboardingSetupBrief({ ...base, locale: 'fr', plan: null })).toContain('French');
  });

  // ── L'Analyst delega: non ha i tool dei mestieri a cui chiede il lavoro ───────────────────────
  // Il thread di setup ora parla con l'Analyst (agent='analyst'), il cui set NON contiene i tool
  // di produzione (generate_content / produce_week), il kit (update_brand_kit, generate_person,
  // add_memory, save_social_handles) né l'audit SEO/GEO (run_seo_geo_audit: è del Web Specialist).
  // Quindi il brief DEVE chiedere il lavoro ai colleghi via message_agent, mai chiamarlo in prima.

  it('l\'analisi SEO/GEO si DELEGA al Web Specialist via message_agent, non si esegue in prima', () => {
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    expect(brief).toContain('message_agent');
    expect(brief).toContain('Web Specialist');
    // Il nome del tool è il modo per delegare, non per chiamarlo: l'audit resta del Web.
    expect(brief).not.toMatch(/call\s+run_seo_geo_audit/i);
    expect(brief).toContain('run_seo_geo_audit');
  });

  it('la produzione di contenuti passerà al Content Creator, l\'Analyst non li produce in prima', () => {
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    expect(brief).toContain('Content Creator');
    expect(brief).toContain('message_agent');
  });

  it('l\'Analyst salva i social di persona (save_social_handles è SUO), non li delega', () => {
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    // Il tool è nell'insieme dell'Analyst: il brief lo chiama in prima persona.
    expect(brief).toContain('save_social_handles');
    // E non dice la bugia "quello è del Content Creator": la social-identity è un suo mestiere.
    expect(brief).toContain('save_social_handles (you own it');
    expect(brief).not.toContain("that tool is the Content Creator's");
  });

  it('il piano editoriale promesso nel messaggio arriva: si delega al Content Creator, non resta promesso', () => {
    const brief = buildOnboardingSetupBrief({ ...base, plan: null });
    expect(brief).toContain('hand the plan itself to the Content Creator');
    expect(brief).toContain('generate_strategy');
  });
});

// ── il brief arriva al modello solo sul thread di setup ────────────────────────────────────────

function surfaceDb(surface: string | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: surface === null ? null : { surface }, error: null }) })
      })
    })
  } as unknown as SupabaseClient;
}

describe('onboardingBriefSection', () => {
  const brand = { name: 'Acme', website: 'https://acme.com', plan: null };

  it('thread di setup → il brief entra nel system prompt', async () => {
    const brief = await onboardingBriefSection(surfaceDb(ONBOARDING_CHAT_SURFACE), 't1', brand, 'it');
    expect(brief).toContain('ONBOARDING SETUP TURN');
    expect(brief).toContain(ROSTER_JOBS[0].key);
  });

  it('thread normale (o maker) → niente brief', async () => {
    expect(await onboardingBriefSection(surfaceDb(null), 't1', brand, 'it')).toBeNull();
    expect(await onboardingBriefSection(surfaceDb('motion'), 't1', brand, 'it')).toBeNull();
  });

  it('senza threadId → niente brief, nessuna query', async () => {
    expect(await onboardingBriefSection(surfaceDb('onboarding'), undefined, brand, 'it')).toBeNull();
  });
});

// ── il messaggio pre-scritto ───────────────────────────────────────────────────────────────────

describe('onboardingSeedMessage', () => {
  it('dice il sito, l\'incarico di setup esplicito, e la lingua in cui rispondere (nome + codice)', () => {
    const m = onboardingSeedMessage('it', { website: 'https://acme.com', brandName: 'Acme' });
    expect(m).toContain('https://acme.com');
    // L'incarico è esplicito: setup del progetto, non una richiesta vaga.
    expect(m).toContain('Set up');
    expect(m).toContain('analyse');
    expect(m).toContain('SEO');
    expect(m).toContain('GTM');
    expect(m).toContain('editorial plan');
    expect(m).toContain('reply in Italian (it)');
  });

  it('una riga per locale: es/fr/en riportano la propria lingua; un locale ignoto cade su English', () => {
    const of = (l: string) => onboardingSeedMessage(l, { website: 'https://a.io', brandName: 'A' });
    expect(of('es')).toContain('reply in Spanish (es)');
    expect(of('fr')).toContain('reply in French (fr)');
    expect(of('en')).toContain('reply in English (en)');
    expect(of('de')).toContain('reply in English (en)');
  });

  it('senza sito usa il nome del brand, non un URL vuoto', () => {
    const m = onboardingSeedMessage('it', { website: null, brandName: 'Acme' });
    expect(m).toContain('Acme');
    expect(m).not.toContain('http');
  });

  it("NON duplica il brief operativo: niente nomi di tool nel messaggio dell'utente", () => {
    const m = onboardingSeedMessage('it', { website: 'https://acme.com', brandName: 'Acme' });
    for (const tool of ['set_goal', 'propose_app_connection', 'run_seo_geo_audit', 'offer_upgrade', 'message_agent'])
      expect(m).not.toContain(tool);
  });
});

// ── seed: thread + riga user scritta subito + turno accodato ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Ricalca le sole catene usate da getOrCreateSurfaceThread / seed / enqueueQueuedChatTurn. */
function seedDb(opts: { existingThread?: Row | null; messages?: Row[]; jobs?: Row[] } = {}) {
  const inserts: Record<string, Row[]> = {};
  const client = {
    from: (table: string) => ({
      select: () => chain(table, 'select'),
      insert: (row: Row) => {
        (inserts[table] ??= []).push(row);
        return chain(table, 'insert', row);
      }
    })
  };
  function resultFor(table: string, mode: string, inserted?: Row) {
    if (mode === 'insert') {
      // saveMessages inserisce un ARRAY di righe e mappa gli id del risultato: deve tornare una lista.
      if (table === 'chat_messages' && Array.isArray(inserted))
        return { data: inserted.map((_, i) => ({ id: `m-${i}` })), error: null };
      // .select('*').single() dopo l'insert del thread; .select('id').maybeSingle() dopo il job.
      return { data: { id: `${table}-id`, ...inserted }, error: null };
    }
    if (table === 'chat_threads') return { data: opts.existingThread ?? null, error: null };
    if (table === 'chat_messages') return { data: opts.messages ?? [], error: null };
    if (table === 'chat_jobs') return { data: opts.jobs ?? [], error: null };
    return { data: null, error: null };
  }
  function chain(table: string, mode: string, inserted?: Row) {
    const api: Row = {
      eq: () => api,
      in: () => api,
      limit: () => api,
      select: () => api,
      maybeSingle: async () => resultFor(table, mode, inserted),
      single: async () => resultFor(table, mode, inserted),
      then: (res?: (v: Row) => unknown) => {
        const v = resultFor(table, mode, inserted);
        return Promise.resolve(res ? res(v) : v);
      }
    };
    return api;
  }
  return { client: client as unknown as SupabaseClient, inserts };
}

describe('seedOnboardingChat', () => {
  const opts = {
    brandId: 'b1',
    userId: 'u1',
    website: 'https://acme.com',
    brandName: 'Acme',
    locale: 'it',
    origin: 'https://app.example'
  };

  it('crea il thread, SCRIVE subito la riga user e accoda il turno con la STESSA stringa', async () => {
    const db = seedDb();
    const threadId = await seedOnboardingChat(db.client, opts);
    expect(threadId).toBeTruthy();

    const thread = db.inserts.chat_threads?.[0];
    expect(thread?.surface).toBe(ONBOARDING_CHAT_SURFACE);
    expect(thread?.surface_key).toBe('b1');
    // Il thread di setup parla con l'Analyst, non con l'agente omni (Anomalia): il suo mestiere è
    // instradare e comporre la squadra, e SEO/GEO li delega al Web Specialist via message_agent.
    expect(thread?.agent).toBe(ONBOARDING_SETUP_AGENT);

    // (1) la riga esiste già alla fine del seed — nessuna finestra con il thread vuoto.
    const msg = (db.inserts.chat_messages?.[0] as unknown as Row[])?.[0];
    expect(msg?.role).toBe('user');
    expect(msg?.thread_id).toBe('chat_threads-id');
    expect(msg?.content).toBe(onboardingSeedMessage('it', opts));

    // (2) e la coda non la duplica: `alreadySaved` in chat/queue.ts confronta il tail con
    // input_params.user_message carattere per carattere, quindi le due devono coincidere.
    const job = db.inserts.chat_jobs?.[0];
    expect(job?.tool_name).toBe('chat_response');
    expect(job?.input_params?.user_message).toBe(msg?.content);
  });

  it('retry del create: thread già con messaggi → nessun secondo turno accodato', async () => {
    const db = seedDb({ existingThread: { id: 't-old' }, messages: [{ id: 'm1' }] });
    const threadId = await seedOnboardingChat(db.client, opts);
    expect(threadId).toBe('t-old');
    expect(db.inserts.chat_jobs).toBeUndefined();
    // né un secondo messaggio: il controllo di idempotenza gira PRIMA della scrittura.
    expect(db.inserts.chat_messages).toBeUndefined();
  });

  it('senza sito usa il nome del brand come soggetto', async () => {
    const db = seedDb();
    await seedOnboardingChat(db.client, { ...opts, website: null });
    const sent = db.inserts.chat_jobs?.[0]?.input_params?.user_message as string;
    expect(sent).toContain('Acme');
    expect(sent).not.toContain('http');
  });
});
