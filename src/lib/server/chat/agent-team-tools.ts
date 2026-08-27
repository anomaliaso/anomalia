import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_CUSTOM_AGENT_SCHEDULES,
  createCustomAgentSchedule,
  deleteCustomAgentSchedule,
  hireCustomAgent,
  listCustomAgentSchedules,
  parseCustomAgentSchedule,
  setCustomAgentScheduleEnabled,
  updateCustomAgentSchedule
} from '$lib/server/custom-agents';
import { nextScheduleRun } from '$lib/server/schedule';
import { describeSchedule } from '$lib/chat-agent-proposal';
import type { RoutineChange, RoutineEventKind } from '$lib/chat-routine-event';
import { proposeTeam, skippedTeam, type TeamFacts } from '$lib/server/agent-team';
import { canConnectSocials } from '$lib/plans';
import { fallbackAvatarColor, fallbackAvatarFace } from '$lib/agent-avatars';
import { ROSTER_JOBS, brandJobOptOuts, scheduledWorkAllowed } from '$lib/server/job-roster';
import {
  JOB_OWNERS,
  TEAM_SPECIALIST_IDS,
  agentForTask,
  looksLikeARole,
  parseRoutineOwner,
  routineOwnerKey,
  type RoutineOwner,
  type TeamAgentId
} from '$lib/agent-owners';
import { resolveDmInitiator, resolveDmTarget } from '$lib/server/chat/agent-dm-tools';
import { getThread } from '$lib/server/chat/persistence';
import { AGENT_IDS, resolveAgent } from '$lib/server/chat/agents';

/**
 * IL TEAM, DALLA CHAT.
 *
 * Gli incarichi ricorrenti (`custom_agent_schedules` + il tick ogni 5 minuti) esistevano già ed
 * erano raggiungibili solo da una pagina di impostazioni: l'utente doveva trovarla, immaginarsi
 * quali agenti gli servissero e scrivere i prompt a mano. Cioè il lavoro per cui è venuto qui.
 * Questi tre tool lo spostano dove la conversazione già avviene.
 *
 * TRE VINCOLI, che sono il motivo per cui questo file è più lungo di tre wrapper CRUD:
 *
 * 1. **Il team lo conferma una persona.** `create_scheduled_agent` crea un incarico, non lo esegue,
 *    e ogni cosa che gli agenti produrranno passa comunque dalla coda di approvazione: nessuna di
 *    queste righe apre una scorciatoia verso la pubblicazione automatica (publishing-settings.ts).
 * 2. **Nessun agente al buio.** `suggest_agent_team` filtra sui fatti del brand, e dice anche cosa
 *    ha scartato e perché: un team che gira a vuoto ogni settimana costa crediti e fiducia, ed è
 *    lo stesso errore che ha tenuto fermo l'analytics review agent per settimane.
 * 3. **Niente duplicati.** Il modello che non vede cosa esiste ricrea "Lettura performance" ogni
 *    volta che se ne parla, finché il brand non sbatte contro il tetto dei 25. Quindi la proposta
 *    porta già con sé cosa è attivo, e la creazione rifiuta un nome già in uso.
 * 4. **Chi propone non assume.** Quando è l'AI ad avere l'idea, `propose_custom_agent` mette in
 *    chat una scheda con tutto quello che serve a decidere — nome, brief integrale, specialista,
 *    giorni e orari — e due bottoni. `create_scheduled_agent` resta la strada di chi l'agente l'ha
 *    chiesto lui. La differenza non è di stile: "sì dai" dentro una conversazione non è il consenso
 *    a un incarico fisso che ogni settimana spende crediti, e il brief vero — quello che l'agente
 *    eseguirà davvero — in prosa scorre via prima di essere letto.
 *
 * ── E ADESSO: LE ROUTINE HANNO UN PROPRIETARIO ─────────────────────────────────────────────────
 *
 * Il modello mentale era "creo un custom agent": ogni incarico ricorrente nasceva come un COLLEGA
 * nuovo, con la sua faccia e la sua card, anche quando il lavoro era chiaramente di uno che c'è
 * già. "Recap del lunedì" comparso accanto all'Analyst, che il recap del lunedì lo fa di mestiere.
 *
 * `owner` risolve questo: una routine si assegna a un agente di default (content/ugc/motion/
 * web/analyst), a un custom agent del brand, o a SE STESSI (`self` = chi sta parlando in questo
 * turno). Il proprietario si scrive nella colonna `agent` con un prefisso — `team:<id>` o
 * `custom:<uuid>`, vedi $lib/agent-owners — quindi niente tabelle nuove, e la routine compare
 * sulla card del suo proprietario e scrive i suoi giri nel diario del suo proprietario.
 * Senza `owner` non cambia niente: nasce il custom agent classico, com'è sempre stato.
 *
 * DUE COSE CHE IL VINCOLO 4 ORA DICE ESPLICITAMENTE:
 * - Assegnare lavoro ricorrente a un COLLEGA è comunque spesa ricorrente di crediti sul brand
 *   della persona. La linea non si sposta perché il destinatario è una macchina: idea dell'AI →
 *   scheda; richiesta dell'utente in QUESTO turno → creazione diretta.
 * - Un turno SCHEDULATO può proporre ma non creare (`create_scheduled_agent` sta in
 *   UNATTENDED_TOOL_EXCLUSIONS, `propose_custom_agent` no): la scheda resta nel diario e aspetta
 *   che qualcuno la confermi. Un agente notturno che si auto-assegna lavoro ricorrente è un loop
 *   di spesa che nessuno ha approvato — e non c'è nessuno a fermarlo fino alla fattura.
 */
export function createAgentTeamTools(opts: {
  supabase: SupabaseClient;
  brandId: string;
  userId: string;
  locale: string;
  timezone: string;
  /** Il thread di questo turno: serve a sapere chi è `self` quando un agente si assegna una routine. */
  threadId?: string;
}) {
  const { supabase, brandId, userId, timezone, threadId } = opts;
  const it = !String(opts.locale ?? '').toLowerCase().startsWith('en');

  /**
   * Il proprietario chiesto dal modello, validato contro il roster VIVO e i custom del brand.
   * Riusa i due risolutori dei DM fra agenti: sono già la definizione di "un agente di questo
   * brand" (id di specialista, `custom:<uuid>` o uuid nudo), e una seconda copia diverge al primo
   * agente nuovo.
   */
  async function resolveOwner(
    target: string | undefined,
    task: string,
    newBecause: string | undefined,
    existing: Awaited<ReturnType<typeof listCustomAgentSchedules>>
  ): Promise<
    | { ok: true; owner: RoutineOwner | null; name: string }
    | { ok: false; error: string; message: string; owner_suggested?: string }
  > {
    const raw = String(target ?? '').trim();

    // ── LA STRADA DI DEFAULT È APPOGGIARSI A CHI C'È GIÀ ───────────────────────────────────────
    // Un agente nuovo non si crea per omissione. Senza `owner` il compito viene classificato
    // (agentForTask, termini e basta) e, se un mestiere lo copre, la chiamata viene RIFIUTATA
    // indicando il proprietario giusto — è il caso vero che ha motivato tutto questo: una routine
    // SEO/GEO proposta come collega nuovo mentre il Web Specialist era già lì a farla.
    if (!raw) {
      const suggested = agentForTask(task);
      if (suggested) {
        return {
          ok: false,
          error: 'owner_suggested',
          owner_suggested: suggested,
          message: `This is ${suggested}'s trade — do not create a new agent for it. Call this again with owner:"${suggested}" and keep the same brief: the prompt is what makes the work specific, the agent stays the same. If you are certain no existing agent covers it, pass owner:"new" together with new_agent_because explaining why.`
        };
      }
      return {
        ok: false,
        error: 'owner_required',
        message: `Say who this routine belongs to: owner:"self", one of ${AGENT_IDS.join('/')}, or a custom agent id${customList(existing)}. Only if none of them covers this work, pass owner:"new" with new_agent_because explaining why nobody does.`
      };
    }

    // L'eccezione, dichiarata. Resta possibile — a volte il lavoro davvero non è di nessuno — ma
    // costa una frase, e quella frase è la differenza fra una scelta e un riflesso.
    if (raw === 'new') {
      const why = String(newBecause ?? '').trim();
      if (why.length < 15) {
        const suggested = agentForTask(task);
        return {
          ok: false,
          error: 'new_agent_unjustified',
          ...(suggested ? { owner_suggested: suggested } : {}),
          message: suggested
            ? `A new agent is the exception, and this looks like ${suggested}'s trade. Either call again with owner:"${suggested}", or pass new_agent_because saying in one sentence why ${suggested} cannot own it.`
            : `A new agent is the exception. Pass new_agent_because: one sentence on why no existing agent${customList(existing)} covers this work.`
        };
      }
      return { ok: true, owner: null, name: '' };
    }

    if (raw === 'self') {
      const me = await speaker();
      return { ok: true, owner: me.owner, name: me.name };
    }

    const found = await resolveDmTarget(supabase, brandId, raw, opts.locale);
    if (!found) {
      return {
        ok: false,
        error: 'owner',
        message: `No agent "${raw}" on this brand. Owner must be "self", one of ${AGENT_IDS.join('/')}, or a custom agent id from list_scheduled_agents${customList(existing)}.`
      };
    }
    const owner: RoutineOwner =
      parseRoutineOwner(found.key) ?? { kind: 'builtin', agentId: (found.agent ?? 'auto') as TeamAgentId };
    return { ok: true, owner, name: found.name };
  }

  /**
   * CHI PARLA in questo thread, risolto una volta sola per turno (i tool del ciclo di vita lo
   * chiedono tutti, e sono due query a testa).
   *
   * `anomalia` è il generalista senza specialista sul thread: la sua card su /agents è `auto`.
   */
  let speakerMemo: Promise<{ name: string; owner: RoutineOwner; key: string }> | null = null;
  function speaker() {
    speakerMemo ??= (async () => {
      const thread = threadId ? await getThread(supabase, threadId, brandId, userId) : null;
      const me = await resolveDmInitiator(supabase, brandId, thread, opts.locale);
      const owner: RoutineOwner =
        parseRoutineOwner(me.key) ?? { kind: 'builtin', agentId: (me.agent ?? 'auto') as TeamAgentId };
      return { name: me.name, owner, key: routineOwnerKey(owner) };
    })();
    return speakerMemo;
  }

  /** Il nome visibile del proprietario scritto in `agent`. '' = la routine non è di nessuno. */
  async function ownerNameOf(owner: RoutineOwner | null): Promise<string> {
    if (!owner) return '';
    // resolveDmTarget conosce gli id nudi degli specialisti e `custom:<uuid>`, non il prefisso
    // `team:` — che è solo il modo in cui il proprietario viene SCRITTO in colonna.
    const key = owner.kind === 'builtin' ? owner.agentId : `custom:${owner.scheduleId}`;
    const found = await resolveDmTarget(supabase, brandId, key, opts.locale);
    return found?.name ?? '';
  }

  /**
   * L'EVENTO DI SISTEMA che la chat disegna sotto il messaggio: `Nuova routine "…"`.
   *
   * Viaggia nel risultato del tool (e da lì nel tool_calls JSON, vedi persistence.ts) per la
   * stessa ragione delle altre card: la compattazione dei turni lunghi butta gli output, e senza
   * questo campo la riga sparirebbe dai thread più vissuti — proprio quelli dove serve sapere
   * quando una routine è nata. Il testo NON è qui: solo i fatti, le parole le mette la i18n.
   */
  async function routineEvent(
    kind: RoutineEventKind,
    row: {
      id: string;
      name: string;
      prompt: string;
      agent: string | null;
      days: number[];
      times: string[];
      enabled: boolean;
    },
    extra: { ownerName?: string; changes?: RoutineChange[] } = {}
  ) {
    const me = await speaker();
    const owner = parseRoutineOwner(row.agent);
    return {
      kind,
      id: row.id,
      name: row.name,
      agent: row.agent,
      owner_name: extra.ownerName ?? (await ownerNameOf(owner)),
      // Senza proprietario non c'è nessun "per X" da dire: la riga resta la sua forma breve.
      self: !owner || routineOwnerKey(owner) === me.key,
      by: me.name,
      days: row.days,
      times: row.times,
      prompt: row.prompt,
      next_run: row.enabled ? nextScheduleRun(row.days, row.times, timezone) : null,
      changes: extra.changes ?? []
    };
  }

  /** "; or one of: Watcher (id), Ronda (id)" — la lista che serve al modello per scegliere. */
  function customList(rows: Awaited<ReturnType<typeof listCustomAgentSchedules>>): string {
    const own = rows.filter((r) => !parseRoutineOwner(r.agent));
    if (!own.length) return '';
    return ` (this brand's own agents: ${own.map((r) => `${r.name} = ${r.id}`).join(', ')})`;
  }

  /**
   * Il nome di una routine è un COMPITO, non una persona — e quando il proprietario esiste già,
   * un nome che suona come un ruolo ricrea a schermo l'ambiguità che l'owner toglie: sulla card
   * dell'Analyst si leggerebbe "Analyst → Social Media Manager".
   */
  function nameProblem(name: string, owner: RoutineOwner | null, ownerName: string): string | null {
    if (!owner) return null;
    if (!looksLikeARole(name)) return null;
    return `"${name}" reads like a person or a role, but this is a ROUTINE of an agent that already exists (${ownerName}). Name it after the task it performs — "Monday recap", "Competitor sweep", "Weekly SEO pass" — not after who does it.`;
  }

  /** I fatti su cui si decide chi ha senso: tutti verificabili, nessuno indovinato. */
  async function loadFacts(): Promise<{ facts: TeamFacts; plan: string | null; status: string }> {
    const { data: brand } = await supabase
      .from('brands')
      .select('plan, status, website, blog_config, own_history_at')
      .eq('id', brandId)
      .maybeSingle();

    const [{ count: accounts }, { count: competitors }, { data: plan }] = await Promise.all([
      supabase.from('social_accounts').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'active'),
      supabase.from('competitors').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
      supabase.from('editorial_plans').select('id').eq('brand_id', brandId).eq('status', 'active').limit(1).maybeSingle()
    ]);

    const planKey = (brand?.plan as string | null) ?? null;
    const subStatus = String(brand?.status ?? 'trial');
    const blogCfg = brand?.blog_config as Record<string, unknown> | null;
    return {
      plan: planKey,
      status: subStatus,
      facts: {
        // canConnectSocials è già false per Go (hasSocialPublishing lo esclude): "prepara ed
        // esporta" non può pubblicare, ma il team di produzione gli serve uguale — è proposeTeam a
        // saperlo, non questo flag.
        canPublish: canConnectSocials(planKey, subStatus),
        connectedAccounts: accounts ?? 0,
        hasWebsite: Boolean(String(brand?.website ?? '').trim()),
        hasBlog: Boolean(blogCfg && Object.keys(blogCfg).length),
        hasOwnPerformanceData: Boolean(brand?.own_history_at),
        hasEditorialPlan: Boolean(plan?.id),
        competitors: competitors ?? 0
      }
    };
  }

  return {
    suggest_agent_team: tool({
      description: [
        'Propose the RECURRING AGENT TEAM for this brand: which standing assignments are worth running, on what days, and why.',
        'Read-only — it creates nothing. Call it when the user asks who could work for them, when setup is finishing, or before create_scheduled_agent so you never invent an assignment the brand cannot support.',
        'The selection is computed from real brand facts (plan, site, blog, editorial plan, own performance data, competitors) — it also returns what was SKIPPED and why, which is worth telling the user.',
        'It returns seeds, not final prompts: rewrite each prompt in the brand’s language and context before creating it.'
      ].join(' '),
      inputSchema: z.object({
        limit: z.number().min(1).max(10).optional().describe('Cap the proposal (highest-value first). Default: all that apply.')
      }),
      execute: async ({ limit }: { limit?: number }) => {
        const { facts } = await loadFacts();
        const existing = await listCustomAgentSchedules(supabase, brandId);
        const proposals = proposeTeam(facts, { limit });
        return {
          success: true,
          facts,
          already_active: existing.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, days: r.days_of_week, times: r.times })),
          slots_left: Math.max(0, MAX_CUSTOM_AGENT_SCHEDULES - existing.length),
          proposed: proposals.map((p) => ({
            key: p.archetype.key,
            suggested_name: it ? p.archetype.name.it : p.archetype.name.en,
            agent: p.archetype.agent,
            // Il proprietario da passare al giro dopo: l'archetipo dichiara già il mestiere, e
            // senza questa riga il modello ripropone un agente NUOVO e si becca owner_suggested.
            suggested_owner: resolveAgent(p.archetype.agent) ?? agentForTask(p.archetype.promptSeed),
            purpose: it ? p.archetype.purpose.it : p.archetype.purpose.en,
            prompt_seed: p.archetype.promptSeed,
            days: p.archetype.daysOfWeek,
            times: p.archetype.times,
            because: p.because
          })),
          skipped: skippedTeam(facts),
          instruction:
            'Present these as a short team, one line each, in the user’s language. Say plainly what each will do and when. ' +
            'Then put the ones that fit on the table with propose_custom_agent — one card each, rewriting prompt_seed into a real brief for THIS brand, and passing owner: `suggested_owner` so the routine goes to the specialist who already does that trade instead of hiring a new agent. Let the user confirm. ' +
            'Do not create anything they did not agree to, and never claim an agent exists before a tool returned its id.'
        };
      }
    }),

    list_scheduled_agents: tool({
      description: [
        'List every recurring ROUTINE this brand already runs, GROUPED BY OWNER — the agent each routine belongs to.',
        'Call it before proposing or creating one: it is how you see what already runs on yourself and on your colleagues, so you never assign a second "Monday recap" to an agent that already has one.',
        '`owner_key` of each group is exactly what you pass as `owner` to propose_custom_agent / create_scheduled_agent. The "standalone" group holds the older custom agents that belong to nobody.'
      ].join(' '),
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await listCustomAgentSchedules(supabase, brandId);
        // Il nome del proprietario custom viene dalle STESSE righe: un custom agent è una riga di
        // questa tabella, quindi il raggruppamento non costa una seconda query.
        const nameById = new Map(rows.map((r) => [r.id, r.name]));

        const groups = new Map<string, { owner_key: string; owner_name: string; routines: unknown[] }>();
        for (const r of rows) {
          const owner = parseRoutineOwner(r.agent);
          const key = owner ? routineOwnerKey(owner) : 'standalone';
          const ownerName =
            owner?.kind === 'builtin'
              ? owner.agentId
              : owner?.kind === 'custom'
                ? (nameById.get(owner.scheduleId) ?? 'deleted agent')
                : 'standalone custom agents';
          const g = groups.get(key) ?? { owner_key: key, owner_name: ownerName, routines: [] };
          g.routines.push({
            id: r.id,
            name: r.name,
            runs_as: r.agent ?? 'auto',
            enabled: r.enabled,
            days: r.days_of_week,
            times: r.times,
            next_run_at: r.next_run_at,
            last_run_at: r.last_run_at,
            last_error: r.last_error
          });
          groups.set(key, g);
        }

        return {
          success: true,
          count: rows.length,
          slots_left: Math.max(0, MAX_CUSTOM_AGENT_SCHEDULES - rows.length),
          by_owner: [...groups.values()],
          // Piatta, per chi la leggeva così prima (e per chi cerca un id senza scorrere i gruppi).
          agents: rows.map((r) => ({
            id: r.id,
            name: r.name,
            agent: r.agent ?? 'auto',
            enabled: r.enabled,
            days: r.days_of_week,
            times: r.times,
            next_run_at: r.next_run_at,
            last_run_at: r.last_run_at,
            last_error: r.last_error
          }))
        };
      }
    }),

    show_team: tool({
      description: [
        'SHOW THE TEAM as a card in the chat: the built-in specialists with their faces, what each one does, the recurring routines under each of them, and this brand’s own custom agents next to them.',
        'Read-only — it creates, changes and schedules nothing.',
        'Call it whenever the user should SEE who works for them: during setup (before proposing any custom agent), when they ask who you are or what the team is, when they wonder who does what.',
        'The card carries the names and descriptions itself, in the user’s language. After calling it, write at most ONE line — never list the agents again in prose, never repeat their descriptions.'
      ].join(' '),
      inputSchema: z.object({}),
      execute: async () => {
        const [{ data: brand }, rows, off] = await Promise.all([
          supabase.from('brands').select('plan').eq('id', brandId).maybeSingle(),
          listCustomAgentSchedules(supabase, brandId),
          brandJobOptOuts(brandId, supabase)
        ]);

        const row = (r: (typeof rows)[number]) => ({
          id: r.id,
          name: r.name,
          days: r.days_of_week,
          times: r.times,
          enabled: r.enabled
        });

        // Le routine assegnate a uno dei sei; tutto il resto (custom agent veri e propri, e le
        // routine che appartengono a un custom agent) finisce nel gruppo "i tuoi agenti".
        // ponytail: nessun annidamento custom→custom nella card — sono elenchi di nomi, non un
        // organigramma; se un giorno serve, la gerarchia è già in `agent` e si legge da lì.
        const byAgent = new Map<string, ReturnType<typeof row>[]>();
        const standalone: ReturnType<typeof row>[] = [];
        for (const r of rows) {
          const owner = parseRoutineOwner(r.agent);
          // Anomalia non ha una card nella squadra (non e' un mestiere): una routine che avesse
          // ancora `team:auto` non deve sparire — sta fra quelle senza proprietario.
          if (owner?.kind === 'builtin' && owner.agentId !== 'auto') {
            const list = byAgent.get(owner.agentId) ?? [];
            list.push(row(r));
            byAgent.set(owner.agentId, list);
          } else {
            standalone.push(row(r));
          }
        }

        const team = {
          agents: TEAM_SPECIALIST_IDS.map((id) => ({
            id,
            routines: ROSTER_JOBS.filter((j) => JOB_OWNERS[j.key] === id).map((j) => ({
              key: j.key,
              enabled: !off.has(j.key)
            })),
            custom: byAgent.get(id) ?? []
          })),
          standalone,
          // La stessa funzione del gate dei tick: la card non può promettere lavoro ricorrente
          // che il piano non fa partire.
          scheduled: scheduledWorkAllowed((brand?.plan as string | null) ?? null)
        };

        return {
          success: true,
          team,
          instruction:
            'The team card is now on screen: every agent with its face, its one-line craft and its routines. ' +
            'Write at most ONE short line about it (e.g. what you would put them to work on first for THIS brand) and move on. ' +
            'Do NOT list the agents, do not repeat what each does, do not restate the routines — the card already says all of it.'
        };
      }
    }),

    propose_custom_agent: tool({
      description: [
        'PROPOSE one recurring ROUTINE to the user: shows a card in the chat with the name, the full standing brief, who owns it, the days and times — and Confirm / Decline buttons. It creates NOTHING.',
        'This is how you suggest recurring work. Whenever the idea is yours (after suggest_agent_team, after spotting recurring work in the conversation, at the end of setup), propose it here instead of creating it.',
        'DEFAULT PATH: add the routine to an agent that ALREADY EXISTS — `owner:"self"` for you, `owner:"web"` / `"content"` / `"analyst"` / `"ugc"` / `"motion"` for the specialist whose trade it is, or a custom agent id from list_scheduled_agents. The prompt is what makes the work specific; the agent stays the same. Hiring a NEW agent (`owner:"new"`) is the exception and needs `new_agent_because` — a crowded team of colleagues doing each other’s job is the failure this prevents.',
        'Proposing work to a colleague is still recurring credit spend on the user’s brand, so it still goes through the card.',
        'One card per routine: three ideas are three calls, so each one can be accepted or refused on its own.',
        'Write `prompt` as the whole brief, in the user’s language — it is shown in full and it is exactly what will be created if they confirm. After calling this, STOP and let them answer: do not also call create_scheduled_agent, and never say it exists.'
      ].join(' '),
      inputSchema: z.object({
        name: z.string().min(1).max(80).describe('Short name of the TASK, e.g. "Lettura performance". With an owner set it must read as a job, never as a person or a role.'),
        prompt: z.string().min(20).max(8000).describe('The standing brief, in the user’s language. Concrete: what to read, what to decide, what to hand back.'),
        owner: z
          .string()
          .describe(
            'REQUIRED. Who this routine belongs to: "self" (you), a specialist id (content|ugc|motion|web|analyst), or a custom agent id from list_scheduled_agents. Prefer whoever already does this trade — SEO/GEO/site/blog is web, posts/calendar/captions is content, analytics/strategy/leads is analyst. Only "new" hires a brand-new agent, and only when nobody covers the work.'
          ),
        new_agent_because: z
          .string()
          .optional()
          .describe('Only with owner:"new". One sentence: why no existing agent can own this work.'),
        agent: z.enum(['publish', 'brand', 'grow', 'web', 'auto']).describe('Which specialist runs it — ignored when `owner` is set (the owner runs its own routines). "auto" lets Anomalia pick per run.'),
        days: z.array(z.number().min(0).max(6)).min(1).describe('0=Sunday .. 6=Saturday'),
        times: z.array(z.string()).min(1).max(4).describe('HH:MM in the brand timezone, e.g. ["09:00"]'),
        because: z.string().max(300).describe('One line, in the user’s language: why this brand needs it now. Shown at the top of the card.'),
        outputs: z.array(z.string()).max(4).optional().describe('What each run leaves behind, 2-4 words each.')
      }),
      execute: async (input: {
        name: string;
        prompt: string;
        owner?: string;
        new_agent_because?: string;
        agent: string;
        days: number[];
        times: string[];
        because: string;
        outputs?: string[];
      }) => {
        // Everything create_scheduled_agent would refuse is refused HERE, before the card is on
        // screen. A card the user confirms and that then fails to create is the one failure this
        // whole flow exists to avoid: they already said yes.
        const existing = await listCustomAgentSchedules(supabase, brandId);
        const owned = await resolveOwner(input.owner, `${input.name} ${input.prompt}`, input.new_agent_because, existing);
        if (!owned.ok)
          return { success: false, error: owned.error, message: owned.message, owner_suggested: owned.owner_suggested };
        const badName = nameProblem(input.name, owned.owner, owned.name);
        if (badName) return { success: false, error: 'name_is_a_role', message: badName };

        const clash = existing.find((r) => r.name.trim().toLowerCase() === input.name.trim().toLowerCase());
        if (clash) {
          return {
            success: false,
            error: 'duplicate',
            existing_id: clash.id,
            message: `An assignment named "${clash.name}" already exists. Propose a different one, or update that one instead.`
          };
        }
        if (existing.length >= MAX_CUSTOM_AGENT_SCHEDULES) {
          return {
            success: false,
            error: 'limit',
            message: `This brand already has the maximum of ${MAX_CUSTOM_AGENT_SCHEDULES} recurring assignments. Remove one first.`
          };
        }
        const parsed = parseCustomAgentSchedule({
          name: input.name,
          prompt: input.prompt,
          agent: owned.owner ? routineOwnerKey(owned.owner) : input.agent,
          avatarFace: fallbackAvatarFace(input.name),
          avatarColor: fallbackAvatarColor(input.name),
          days: input.days,
          times: input.times,
          enabled: true,
          reuseThread: false
        });
        if (!parsed.ok) {
          return {
            success: false,
            error: parsed.error,
            message:
              parsed.error === 'times'
                ? 'Times must be HH:MM in 24h form, at most 12 per day.'
                : parsed.error === 'days'
                  ? 'Days must be 0 (Sunday) to 6 (Saturday).'
                  : `Invalid ${parsed.error}.`
          };
        }

        return {
          success: true,
          // The card reads THIS object, and so does /chat/agents/confirm when the user says yes —
          // it re-reads it from the saved message rather than trusting anything the browser posts.
          // `agent` carries the owner prefix when there is one: the confirm route re-parses it,
          // so a card that said "a routine for the Analyst" cannot create a colleague instead.
          proposal: {
            name: parsed.value.name,
            prompt: parsed.value.prompt,
            agent: parsed.value.agent ?? 'auto',
            owner_name: owned.name,
            days: parsed.value.daysOfWeek,
            times: parsed.value.times,
            because: String(input.because ?? '').trim().slice(0, 300),
            outputs: (input.outputs ?? []).map((o) => String(o).trim()).filter(Boolean).slice(0, 4)
          },
          slots_left: Math.max(0, MAX_CUSTOM_AGENT_SCHEDULES - existing.length),
          instruction:
            'The card is now on screen with Confirm and Decline. Write at most one short line about it — do not repeat the prompt, the days or the times, they are all in the card. ' +
            'Then STOP: no create_scheduled_agent, no second proposal in the same turn unless the user asked for several, and do not claim anything was created.'
        };
      }
    }),

    create_scheduled_agent: tool({
      description: [
        'Put one recurring ROUTINE to work: a standing assignment that runs on the given days/times and does the job described in `prompt`.',
        'DEFAULT PATH: `owner` names an agent that ALREADY EXISTS — "self", a specialist whose trade it is (web for SEO/GEO/site/blog, content for posts/calendar, analyst for analytics/strategy/leads, ugc and motion for their formats), or a custom agent id. Its runs then land in that agent’s own work journal instead of opening a new thread, and the prompt is the custom command that makes the work specific.',
        'owner:"new" hires a brand-new agent and requires new_agent_because — use it only when no existing agent covers the work, and say so to the user. Crowding the team with colleagues who duplicate each other is the failure this prevents.',
        'ONLY when the user asked for THIS routine themselves in this turn ("every Monday send me…", "give the analyst a weekly sweep") or confirmed a proposal card. When the idea is yours — including when you want to give yourself or a colleague standing work — call propose_custom_agent instead and wait: recurring work is recurring credit spend, and that is the user’s call, not yours.',
        'The prompt is the whole brief: write it as you would ask a colleague, in the user’s language, concrete about what to look at and what to hand back. It cannot publish anything on its own — everything it produces still goes through the approval queue.',
        'Times are HH:MM in the brand’s timezone; days are 0=Sunday..6=Saturday.'
      ].join(' '),
      inputSchema: z.object({
        name: z.string().min(1).max(80).describe('Short name of the TASK, e.g. "Lettura performance". With an owner set it must read as a job, never as a person or a role.'),
        prompt: z.string().min(20).max(8000).describe('The standing brief. Concrete: what to read, what to decide, what to hand back.'),
        owner: z
          .string()
          .describe(
            'REQUIRED. Who this routine belongs to: "self" (you), a specialist id (content|ugc|motion|web|analyst), or a custom agent id from list_scheduled_agents. Prefer whoever already does this trade — SEO/GEO/site/blog is web, posts/calendar/captions is content, analytics/strategy/leads is analyst. Only "new" hires a brand-new agent, and only when nobody covers the work.'
          ),
        new_agent_because: z
          .string()
          .optional()
          .describe('Only with owner:"new". One sentence: why no existing agent can own this work.'),
        agent: z
          .enum(['publish', 'brand', 'grow', 'web', 'auto'])
          .describe('Which specialist runs it — ignored when `owner` is set (the owner runs its own routines). "auto" lets Anomalia pick per run.'),
        days: z.array(z.number().min(0).max(6)).min(1).describe('0=Sunday .. 6=Saturday'),
        times: z.array(z.string()).min(1).max(4).describe('HH:MM in the brand timezone, e.g. ["09:00"]'),
        enabled: z.boolean().optional().describe('Default true — create it already running.')
      }),
      execute: async (input: {
        name: string;
        prompt: string;
        owner?: string;
        new_agent_because?: string;
        agent: string;
        days: number[];
        times: string[];
        enabled?: boolean;
      }) => {
        const existing = await listCustomAgentSchedules(supabase, brandId);
        const owned = await resolveOwner(input.owner, `${input.name} ${input.prompt}`, input.new_agent_because, existing);
        if (!owned.ok)
          return { success: false, error: owned.error, message: owned.message, owner_suggested: owned.owner_suggested };
        const badName = nameProblem(input.name, owned.owner, owned.name);
        if (badName) return { success: false, error: 'name_is_a_role', message: badName };

        // Un modello che non vede cosa esiste ricrea lo stesso agente ogni volta che se ne parla.
        const clash = existing.find((r) => r.name.trim().toLowerCase() === input.name.trim().toLowerCase());
        if (clash) {
          return {
            success: false,
            error: 'duplicate',
            existing_id: clash.id,
            message: `An assignment named "${clash.name}" already exists. Update or rename it instead of creating a second one.`
          };
        }
        if (existing.length >= MAX_CUSTOM_AGENT_SCHEDULES) {
          return {
            success: false,
            error: 'limit',
            message: `This brand already has the maximum of ${MAX_CUSTOM_AGENT_SCHEDULES} recurring assignments. Remove one first.`
          };
        }

        const parsed = parseCustomAgentSchedule({
          name: input.name,
          prompt: input.prompt,
          agent: owned.owner ? routineOwnerKey(owned.owner) : input.agent,
          avatarFace: fallbackAvatarFace(input.name),
          avatarColor: fallbackAvatarColor(input.name),
          days: input.days,
          times: input.times,
          enabled: input.enabled !== false,
          reuseThread: false
        });
        if (!parsed.ok) {
          return {
            success: false,
            error: parsed.error,
            message:
              parsed.error === 'times'
                ? 'Times must be HH:MM in 24h form, at most 12 per day.'
                : parsed.error === 'days'
                  ? 'Days must be 0 (Sunday) to 6 (Saturday).'
                  : `Invalid ${parsed.error}.`
          };
        }

        // ASSUMERE È UNA COSA, DARE UN INCARICO UN'ALTRA (0210). Con un proprietario la routine si
        // appoggia a chi c'è già; con `owner:"new"` nasce prima l'AGENTE e poi il suo primo
        // incarico, invece di una riga che è insieme la persona e il compito.
        const created = owned.owner
          ? await createCustomAgentSchedule(supabase, { brandId, userId, timezone, input: parsed.value })
          : await hireCustomAgent(supabase, {
              brandId,
              userId,
              timezone,
              agent: {
                name: parsed.value.name,
                prompt: parsed.value.prompt,
                agent: parsed.value.agent,
                avatarFace: parsed.value.avatarFace,
                avatarColor: parsed.value.avatarColor,
                enabled: true
              },
              routine: parsed.value
            });
        if (!created.ok) {
          return { success: false, error: created.error, message: 'Could not save the assignment.' };
        }
        // La routine appena creata appartiene all'agente appena assunto: l'evento di sistema e la
        // risposta devono dirlo, o in chat comparirebbe di nuovo "un collega nuovo" e basta.
        const createdId = 'scheduleId' in created ? created.scheduleId : created.id;
        const ownerKey = owned.owner
          ? routineOwnerKey(owned.owner)
          : `custom:${(created as { agentId: string }).agentId}`;
        const routineAgent = owned.owner ? parsed.value.agent : ownerKey;
        return {
          success: true,
          id: createdId,
          name: parsed.value.name,
          agent: routineAgent ?? 'auto',
          owner: ownerKey,
          owner_name: owned.name || parsed.value.name,
          days: parsed.value.daysOfWeek,
          times: parsed.value.times,
          enabled: parsed.value.enabled,
          routine_event: await routineEvent(
            'created',
            {
              id: createdId,
              name: parsed.value.name,
              prompt: parsed.value.prompt,
              agent: routineAgent,
              days: parsed.value.daysOfWeek,
              times: parsed.value.times,
              enabled: parsed.value.enabled
            },
            { ownerName: owned.name || parsed.value.name }
          ),
          instruction:
            'A system line is now in the chat with the name, the owner, the cadence and the whole brief — it is the record. ' +
            'Write AT MOST one short line about it and do not repeat what the line already carries: no brief, no days, no times, no next run.'
        };
      }
    }),

    update_scheduled_agent: tool({
      description: [
        'CHANGE one recurring routine that already exists: rename it, rewrite its brief, or move it to other days/times.',
        'Use it instead of deleting and recreating — the routine keeps its id, its history and its owner, and the user keeps the agent they already know.',
        'Pass only the fields that change; everything you leave out stays as it is. Rewriting `prompt` REPLACES the whole brief, so send it complete, never a patch.',
        'A system line then shows in the chat what changed, before → after: say at most one line about it and do not recite the new brief or the new schedule in prose.'
      ].join(' '),
      inputSchema: z.object({
        id: z.string().describe('Routine id from list_scheduled_agents'),
        name: z.string().min(1).max(80).optional().describe('New name of the TASK. Never a role or a person.'),
        prompt: z.string().min(20).max(8000).optional().describe('The NEW standing brief, complete — it replaces the old one.'),
        days: z.array(z.number().min(0).max(6)).min(1).optional().describe('0=Sunday .. 6=Saturday'),
        times: z.array(z.string()).min(1).max(4).optional().describe('HH:MM in the brand timezone')
      }),
      execute: async (input: { id: string; name?: string; prompt?: string; days?: number[]; times?: string[] }) => {
        const rows = await listCustomAgentSchedules(supabase, brandId);
        const row = rows.find((r) => r.id === input.id);
        if (!row) {
          return {
            success: false,
            error: 'missing',
            message: `No routine with id "${input.id}" on this brand. Call list_scheduled_agents and use an id from there.`
          };
        }

        const name = String(input.name ?? '').trim() || row.name;
        const prompt = String(input.prompt ?? '').trim() || row.prompt;
        const days = input.days ?? row.days_of_week ?? [];
        const times = input.times ?? row.times ?? [];

        const owner = parseRoutineOwner(row.agent);
        const ownerName = await ownerNameOf(owner);
        if (name !== row.name) {
          const badName = nameProblem(name, owner, ownerName);
          if (badName) return { success: false, error: 'name_is_a_role', message: badName };
          const clash = rows.find(
            (r) => r.id !== row.id && r.name.trim().toLowerCase() === name.trim().toLowerCase()
          );
          if (clash) {
            return {
              success: false,
              error: 'duplicate',
              existing_id: clash.id,
              message: `Another routine is already named "${clash.name}". Pick a different name.`
            };
          }
        }

        const parsed = parseCustomAgentSchedule({
          name,
          prompt,
          agent: row.agent,
          // Faccia e colore restano quelli: una modifica al brief non deve cambiare l'avatar che
          // l'utente riconosce sulla card.
          avatarFace: row.avatar_face ?? fallbackAvatarFace(name),
          avatarColor: row.avatar_color ?? fallbackAvatarColor(name),
          days,
          times,
          enabled: row.enabled,
          reuseThread: row.reuse_thread
        });
        if (!parsed.ok) {
          return {
            success: false,
            error: parsed.error,
            message:
              parsed.error === 'times'
                ? 'Times must be HH:MM in 24h form, at most 12 per day.'
                : parsed.error === 'days'
                  ? 'Days must be 0 (Sunday) to 6 (Saturday).'
                  : `Invalid ${parsed.error}.`
          };
        }

        // Il "prima → dopo" si calcola sui valori NORMALIZZATI: ["9:00"] e ["09:00"] sono lo
        // stesso orario, e una riga che annuncia un cambio che non c'è stato è rumore.
        const before = cadenceKey(row.days_of_week ?? [], row.times ?? []);
        const after = cadenceKey(parsed.value.daysOfWeek, parsed.value.times);
        const changes: RoutineChange[] = [];
        if (parsed.value.name !== row.name) changes.push({ field: 'name', from: row.name, to: parsed.value.name });
        if (parsed.value.prompt !== row.prompt)
          changes.push({ field: 'prompt', from: row.prompt, to: parsed.value.prompt });
        if (after !== before) {
          // Il prima→dopo di una cadenza è testo GIÀ RESO: è la fotografia di com'era, e a
          // differenza dell'etichetta della riga non deve cambiare se domani si cambia lingua.
          changes.push({
            field: 'schedule',
            from: describeSchedule(row.days_of_week ?? [], row.times ?? [], opts.locale),
            to: describeSchedule(parsed.value.daysOfWeek, parsed.value.times, opts.locale)
          });
        }
        if (!changes.length) {
          return {
            success: false,
            error: 'nothing_to_change',
            message: `Nothing in "${row.name}" would change. Say what should be different: name, prompt, days or times.`
          };
        }

        const done = await updateCustomAgentSchedule(supabase, {
          brandId,
          id: row.id,
          timezone,
          input: parsed.value
        });
        if (!done.ok) return { success: false, error: done.error, message: 'Could not save the change.' };

        return {
          success: true,
          id: row.id,
          name: parsed.value.name,
          days: parsed.value.daysOfWeek,
          times: parsed.value.times,
          routine_event: await routineEvent(
            'updated',
            {
              id: row.id,
              name: parsed.value.name,
              prompt: parsed.value.prompt,
              agent: parsed.value.agent,
              days: parsed.value.daysOfWeek,
              times: parsed.value.times,
              enabled: parsed.value.enabled
            },
            { ownerName, changes }
          ),
          instruction:
            'The system line in the chat already shows what changed, before → after, and the new brief in full. ' +
            'One short line at most, and do not repeat any of it.'
        };
      }
    }),

    set_scheduled_agent_enabled: tool({
      description:
        'Pause, resume or delete one recurring agent assignment. Use when the user says an agent is too noisy, no longer needed, or should start again. Deleting is permanent — prefer pausing unless they asked to remove it. To change WHAT it does or WHEN it runs, use update_scheduled_agent instead of deleting it. A system line then reports the change in the chat, so acknowledge it in one short line without restating the name, the brief or the schedule.',
      inputSchema: z.object({
        id: z.string().describe('Assignment id from list_scheduled_agents'),
        action: z.enum(['pause', 'resume', 'delete'])
      }),
      execute: async ({ id, action }: { id: string; action: 'pause' | 'resume' | 'delete' }) => {
        // Nome, brief e proprietario servono alla riga di sistema — e dopo un delete non esistono
        // più da nessuna parte: si leggono PRIMA di toccare la riga, non dopo.
        const { data: row } = await supabase
          .from('custom_agent_schedules')
          .select('id, name, prompt, agent, days_of_week, times')
          .eq('brand_id', brandId)
          .eq('id', id)
          .maybeSingle();
        if (!row) return { success: false, error: 'missing' };

        const ok =
          action === 'delete'
            ? await deleteCustomAgentSchedule(supabase, { brandId, id })
            : await setCustomAgentScheduleEnabled(supabase, {
                brandId,
                id,
                enabled: action === 'resume',
                timezone
              });
        if (!ok) return { success: false, error: 'missing' };

        return {
          success: true,
          id,
          action,
          routine_event: await routineEvent(
            action === 'delete' ? 'deleted' : action === 'pause' ? 'paused' : 'resumed',
            {
              id,
              name: String(row.name ?? ''),
              prompt: String(row.prompt ?? ''),
              agent: (row.agent as string | null) ?? null,
              days: (row.days_of_week as number[]) ?? [],
              times: (row.times as string[]) ?? [],
              // Solo un resume ha un prossimo giro: una routine spenta o cancellata non ne ha.
              enabled: action === 'resume'
            }
          )
        };
      }
    })
  };
}

/** "1,4·09:00" — forma canonica di una cadenza, solo per confrontare prima e dopo. */
function cadenceKey(days: number[], times: string[]): string {
  return `${[...days].sort().join(',')}·${[...times].sort().join(',')}`;
}
