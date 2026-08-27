import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { createAdminClient } from '$lib/server/supabase-admin';
import { createThread, saveMessages } from '$lib/server/chat/persistence';
import { ROSTER_JOBS, jobOwner, type JobKey } from '$lib/server/job-roster';
import type { TeamAgentId } from '$lib/agent-owners';

/**
 * ACCENSIONE DELLA SQUADRA (team ignition) — il momento in cui il piano a pagamento è confermato
 * e la squadra di default deve INIZIARE a lavorare, invece di aspettare che qualcuno la scopra.
 *
 * PERCHÉ ESISTE. Il difetto che questo modulo rimuove è documentato: un brand Pro è rimasto per
 * mesi con `autopilot_enabled=false` e zero run dello scheduler — la macchina non si accendeva
 * mai da sola. L'accensione ora è un atto esplicito del checkout: `igniteBrandTeam` viene chiamata
 * UNA volta quando il pagamento è confermato, e da lì in poi i cron fanno il resto.
 *
 * IDEMPOTENTE per costruzione: i webhook Stripe si ripetono, le pagine di attivazione si
 * ricaricano. Una seconda chiamata non crea una seconda squadra — i thread sono get-or-create,
 * il radar si accende solo se non ha già una scelta, e il primo giro parte solo alla PRIMA
 * accensione vera (quando almeno un thread è stato creato adesso).
 *
 * COSA NON FA. Non tocca `brands.plan` (lo scrive il billing), non scrive più
 * `autopilot_enabled` (ritirato: il producer è un lavoro del roster, assenza di opt-out =
 * acceso), e non manda MAI una chiamata a un modello: i messaggi di presentazione sono testo
 * statico — al momento del checkout costi e latenza sono il posto peggiore per una generazione.
 */

// ── Identità dei thread ─────────────────────────────────────────────────────────────────────────
// UN thread persistente per AGENTE della squadra (non più per job): i lavori del roster sono le
// ROUTINE dei sei agenti veri della chat, e ogni routine scrive il suo resoconto nel diario del
// suo proprietario (JOB_OWNERS in $lib/agent-owners). Il marcatore è la coppia ESISTENTE
// surface='team' + surface_key=<agentId> (0199, indice unico ⇒ get-or-create senza gare), con
// `agent=<agentId>` vero: il thread si presenta ovunque con la faccia e il nome dello specialista,
// e rispondergli dentro È parlare con quello specialista. I vecchi thread `agent='job:<key>'`
// restano leggibili (thread-identity li risolve come alias legacy) ma non ricevono più report.
const TEAM_SURFACE = 'team';

type OwnerInfo = { userId: string; locale: 'en' | 'it' | 'es' | 'fr' };

/** Owner del brand (via organizations.owner_id) + la sua lingua. Null = brand orfano, niente thread. */
async function brandOwner(admin: SupabaseClient, brandId: string): Promise<OwnerInfo | null> {
  const { data: brand } = await admin.from('brands').select('org_id').eq('id', brandId).maybeSingle();
  if (!brand?.org_id) return null;
  const { data: org } = await admin
    .from('organizations')
    .select('owner_id')
    .eq('id', brand.org_id)
    .maybeSingle();
  if (!org?.owner_id) return null;
  const { data: profile } = await admin
    .from('profiles')
    .select('locale')
    .eq('id', org.owner_id)
    .maybeSingle();
  const loc = String(profile?.locale ?? '').slice(0, 2).toLowerCase();
  return {
    userId: org.owner_id as string,
    locale: loc === 'it' || loc === 'es' || loc === 'fr' ? (loc as OwnerInfo['locale']) : 'en'
  };
}

// ── Copy statica per agente ─────────────────────────────────────────────────────────────────────
// I titoli dei thread sono le etichette del composer (i18n chat.agents.*.label) — identiche in
// tutti i cataloghi, quindi qui basta UNA stringa. Se un'etichetta cambia là, va cambiata anche
// qui: il thread si chiama come l'agente nel picker.
const AGENT_TITLES: Record<TeamAgentId, string> = {
  auto: 'Anomalia',
  content: 'Content Creator',
  ugc: 'UGC Specialist',
  motion: 'Motion Specialist',
  analyst: 'Analyst',
  web: 'Web Specialist'
};

// I nomi delle ROUTINE — gli stessi del roster in i18n (app.roster.job.*.name), ricopiati qui
// perché il catalogo svelte-i18n è client-side e non si importa in un cron (stessa scelta di
// email-i18n.ts). Prefissano ogni report nel diario dell'agente: il thread si legge come un
// giornale di lavoro ("Produzione settimanale — ho prodotto 5 post…").
const ROUTINE_NAMES: Record<JobKey, Record<OwnerInfo['locale'], string>> = {
  autopilot: { en: 'Weekly production', it: 'Produzione settimanale', es: 'Producción semanal', fr: 'Production hebdomadaire' },
  analytics_review: { en: 'Performance review', it: 'Revisione delle performance', es: 'Revisión de rendimiento', fr: 'Revue des performances' },
  weekly_recap: { en: 'Monday recap', it: 'Recap del lunedì', es: 'Resumen del lunes', fr: 'Récap du lundi' },
  seo: { en: 'SEO review', it: 'Revisione SEO', es: 'Revisión SEO', fr: 'Revue SEO' },
  geo: { en: 'AI visibility check', it: 'Controllo visibilità AI', es: 'Control de visibilidad en IA', fr: 'Contrôle de visibilité IA' },
  radar_recap: { en: 'Daily radar digest', it: 'Digest quotidiano del radar', es: 'Resumen diario del radar', fr: 'Digest quotidien du radar' },
  market_refs: { en: 'Competitor watch', it: 'Osservazione dei competitor', es: 'Vigilancia de competidores', fr: 'Veille concurrents' },
  strategy_review: { en: 'Strategy review', it: 'Revisione della strategia', es: 'Revisión de la estrategia', fr: 'Revue de la stratégie' },
  library: { en: 'Site re-scan', it: 'Riscansione del sito', es: 'Reescaneo del sitio', fr: 'Re-scan du site' }
};

// Il primo messaggio del thread: chi è l'agente, quali routine possiede, quando partono. Testo
// statico, MAI un modello (vedi sopra). it/en completi; es/fr cadono sull'inglese. Solo gli agenti
// CON routine hanno un seed: ugc/motion/auto non ricevono thread all'accensione — il loro nasce
// alla prima conversazione vera, meno thread vuoti in sidebar.
// ponytail: es/fr in inglese — si aggiungono le due lingue quando i clienti es/fr esistono davvero.
const SEEDS: Partial<Record<TeamAgentId, { en: string; it: string }>> = {
  content: {
    it: 'Sono il tuo Content Creator. La mia routine: ogni settimana pianifico e produco il tuo batch ricorrente di post, poi ti chiedo l\u2019approvazione via email. Il primo ciclo parte con la tua prima settimana di piano. Questo \u00e8 il mio diario di lavoro: ogni giro lascia qui il suo resoconto.',
    en: 'I\u2019m your Content Creator. My routine: every week I plan and produce your recurring batch of posts, then ask for your approval by email. The first cycle starts with your first planned week. This is my work journal: every run leaves its report here.'
  },
  analyst: {
    it: 'Sono il tuo Analyst. Le mie routine: la revisione delle performance, il recap del luned\u00ec, il digest quotidiano del radar, l\u2019osservazione dei competitor e la revisione della strategia. Lavoro a valle dei tuoi primi dati. Questo \u00e8 il mio diario di lavoro: ogni giro lascia qui il suo resoconto.',
    en: 'I\u2019m your Analyst. My routines: the performance review, the Monday recap, the daily radar digest, competitor watch and the strategy review. I work off your first real data. This is my work journal: every run leaves its report here.'
  },
  web: {
    it: 'Sono il tuo Web Specialist. Le mie routine: la revisione SEO, il controllo della visibilit\u00e0 sulle AI e la riscansione del sito. I primi giri partono entro il tuo primo giorno. Questo \u00e8 il mio diario di lavoro: ogni giro lascia qui il suo resoconto.',
    en: 'I\u2019m your Web Specialist. My routines: the SEO review, the AI visibility check and the site re-scan. The first runs start within your first day. This is my work journal: every run leaves its report here.'
  }
};

function seedFor(agentId: TeamAgentId, locale: OwnerInfo['locale']): string | null {
  const sd = SEEDS[agentId];
  if (!sd) return null;
  return locale === 'it' ? sd.it : sd.en;
}

// ── Thread get-or-create ────────────────────────────────────────────────────────────────────────

/**
 * Il thread persistente di UN agente della squadra. Get-or-create su surface='team' +
 * surface_key=<agentId> (indice unico 0199: niente doppioni anche con due cron nello stesso
 * secondo). `agent=<agentId>` è l'id VERO dello specialista: il thread ha la sua faccia in
 * sidebar e un turno accodato lì dentro gira con il suo prompt e i suoi tool.
 */
export async function getOrCreateTeamThread(
  admin: SupabaseClient,
  brandId: string,
  agentId: TeamAgentId
): Promise<{ threadId: string; userId: string; locale: OwnerInfo['locale']; created: boolean } | null> {
  const owner = await brandOwner(admin, brandId);
  if (!owner) return null;

  const { data: existing } = await admin
    .from('chat_threads')
    .select('id')
    .eq('brand_id', brandId)
    .eq('user_id', owner.userId)
    .eq('surface', TEAM_SURFACE)
    .eq('surface_key', agentId)
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    return { threadId: existing.id as string, userId: owner.userId, locale: owner.locale, created: false };
  }

  const thread = await createThread(
    admin,
    brandId,
    owner.userId,
    AGENT_TITLES[agentId],
    null,
    agentId === 'auto' ? null : agentId,
    TEAM_SURFACE,
    agentId
  );
  if (!thread?.id) return null;

  // Il messaggio di presentazione. saveMessages ALZA se l'insert non entra: qui si cattura e si
  // va avanti — un seed mancato non deve impedire né l'accensione né i report futuri.
  const seed = seedFor(agentId, owner.locale);
  if (seed) {
    try {
      await saveMessages(admin, brandId, owner.userId, [{ role: 'assistant', content: seed }], thread.id);
    } catch (e) {
      console.warn('[team-ignition] seed message failed:', e instanceof Error ? e.message.slice(0, 160) : e);
    }
  }
  return { threadId: thread.id, userId: owner.userId, locale: owner.locale, created: true };
}

/** Il thread in cui lavora un job del roster: quello del suo agente proprietario. */
export async function getOrCreateAgentThread(
  admin: SupabaseClient,
  brandId: string,
  jobKey: JobKey
): Promise<{ threadId: string; userId: string; locale: OwnerInfo['locale']; created: boolean } | null> {
  return getOrCreateTeamThread(admin, brandId, jobOwner(jobKey));
}

// ── Report dei giri ─────────────────────────────────────────────────────────────────────────────

/**
 * I fatti che ogni lavoro passa quando ha DAVVERO fatto qualcosa. Testo deterministico, mai un
 * modello. I giri saltati (fresh, no_plan, crediti…) NON scrivono: una squadra che posta "non ho
 * fatto niente" ogni giorno insegna a ignorare i thread — quegli stati li mostra già /agents.
 */
export type JobReport =
  | { job: 'autopilot'; postsCreated: number; emailed: boolean; planned?: boolean }
  | { job: 'analytics_review'; actions: number; hasNotes: boolean }
  | { job: 'weekly_recap'; published: number; pending: number; scheduled: number }
  | { job: 'seo'; initiatives: number }
  | { job: 'geo'; citability: number | null; techScore: number | null }
  | { job: 'radar_recap'; sent: true }
  | { job: 'market_refs'; references: number }
  | { job: 'library'; pages: number };

function formatReport(r: JobReport, locale: OwnerInfo['locale']): string {
  const it = locale === 'it';
  switch (r.job) {
    case 'autopilot':
      if (r.planned) {
        return it
          ? 'Ho pianificato la prossima settimana di contenuti: le righe sono su /plan in attesa della tua revisione. Se non intervieni, procedo con la mia proposta al prossimo ciclo.'
          : 'I planned your next week of content: the rows are on /plan awaiting your review. If you don’t act, I proceed with my proposal on the next cycle.';
      }
      return it
        ? `Ho prodotto ${r.postsCreated} post per la settimana. ${r.emailed ? 'Ti ho mandato l’email di approvazione: un tap e vanno in calendario.' : 'Li trovi in attesa di approvazione nell’app.'}`
        : `I produced ${r.postsCreated} posts for the week. ${r.emailed ? 'I sent you the approval email — one tap and they’re scheduled.' : 'They’re awaiting your approval in the app.'}`;
    case 'analytics_review':
      return it
        ? `Ho riletto le performance dei tuoi post e applicato ${r.actions} ${r.actions === 1 ? 'intervento' : 'interventi'}${r.hasNotes ? ', con qualche nota sul perché' : ''}. I dettagli sono nella pagina delle performance.`
        : `I reviewed your posts’ performance and applied ${r.actions} ${r.actions === 1 ? 'change' : 'changes'}${r.hasNotes ? ', with notes on why' : ''}. Details are on the performance page.`;
    case 'weekly_recap':
      return it
        ? `Riepilogo della settimana inviato via email: ${r.published} post pubblicati, ${r.scheduled} programmati, ${r.pending} in attesa di una tua decisione.`
        : `Weekly recap sent by email: ${r.published} posts published, ${r.scheduled} scheduled, ${r.pending} waiting on you.`;
    case 'seo':
      return it
        ? `Revisione SEO completata: piano aggiornato con ${r.initiatives} ${r.initiatives === 1 ? 'iniziativa' : 'iniziative'}. Le trovi nella sezione SEO.`
        : `SEO review done: plan refreshed with ${r.initiatives} ${r.initiatives === 1 ? 'initiative' : 'initiatives'}. They’re in the SEO section.`;
    case 'geo': {
      const score = r.citability != null ? ` ${it ? 'Punteggio di citabilità' : 'Citability score'}: ${r.citability}/100.` : '';
      return it
        ? `Audit di visibilità sulle AI completato e snapshot salvato per l’andamento.${score}`
        : `AI visibility audit done, snapshot stored for the trend.${score}`;
    }
    case 'radar_recap':
      return it
        ? 'Il radar ha trovato qualcosa nel tuo campo: ti ho mandato il digest di oggi via email. I dettagli sono nella sezione Radar.'
        : 'The radar found something in your field: I emailed you today’s digest. Details are in the Radar section.';
    case 'market_refs':
      return it
        ? `Ho aggiornato l’osservazione dei competitor: ${r.references} ${r.references === 1 ? 'riferimento attuale' : 'riferimenti attuali'} su cosa stanno pubblicando.`
        : `Competitor watch refreshed: ${r.references} current ${r.references === 1 ? 'reference' : 'references'} on what they’re publishing.`;
    case 'library':
      return it
        ? `Ho riscansionato il tuo sito: ${r.pages} pagine indicizzate. Gli agenti ora scrivono dalla versione aggiornata.`
        : `I re-scanned your site: ${r.pages} pages indexed. The agents now write from the fresh version.`;
  }
}

/**
 * Scrive il resoconto di un giro nel thread del suo agente. NON ALZA MAI: il lavoro è già stato
 * fatto quando si arriva qui, e un report che non entra non deve far risultare fallito il job
 * (saveMessages ora alza sugli errori di insert — è esattamente il caso da contenere).
 */
export async function reportToAgentThread(
  admin: SupabaseClient,
  brandId: string,
  report: JobReport
): Promise<void> {
  try {
    const t = await getOrCreateAgentThread(admin, brandId, report.job);
    if (!t) return;
    // Il prefisso è il nome della ROUTINE: nel diario dell'agente convivono più routine, e
    // senza l'intestazione un thread dell'Analyst sarebbe una colonna di numeri senza mittente.
    const content = `**${ROUTINE_NAMES[report.job][t.locale]}** — ${formatReport(report, t.locale)}`;
    await saveMessages(admin, brandId, t.userId, [{ role: 'assistant', content }], t.threadId);
  } catch (e) {
    console.warn(`[team-ignition] report for ${report.job} not saved:`, e instanceof Error ? e.message.slice(0, 160) : e);
  }
}

// ── Il primo giro ───────────────────────────────────────────────────────────────────────────────

/**
 * Chi paga mercoledì non deve aspettare il cron di lunedì. Si sveglia SOLO i lavori il cui primo
 * giro produce valore su un brand appena nato, via i loro stessi tick con `?brand=<slug>`:
 *   geo          — primo audit + primo snapshot (il trend parte da qui)
 *   seo          — gira dopo geo; se l'audit non c'è ancora salta pulito e riprova al cron
 *   market_refs  — i competitor arrivano dall'onboarding, il refresh ha già materia
 *   library      — prima scansione del sito (se l'onboarding l'ha già fatta, il gate fresh salta)
 * Gli altri no, e il perché conta: autopilot duplicherebbe la settimana 1 dell'onboarding,
 * analytics/weekly_recap/strategy_review non hanno ancora dati, il radar scansiona già più volte
 * al giorno per conto suo.
 *
 * ponytail: `void fetch` come kickChatQueueWork — in serverless la function può morire prima che
 * la fetch parta. Il paracadute è che ognuno di questi lavori ha comunque il suo cron entro 24h.
 */
function kickFirstLap(slug: string): void {
  const base = (publicEnv.PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (!base) return;
  const headers: Record<string, string> = {};
  if (env.AUTOPILOT_SECRET) headers['x-autopilot-secret'] = env.AUTOPILOT_SECRET;
  else if (env.CRON_SECRET) headers.authorization = `Bearer ${env.CRON_SECRET}`;
  else return; // senza segreto i tick rispondono 401: inutile provarci
  for (const path of ['/api/v1/geo/tick', '/api/v1/seo/review/tick', '/api/v1/market-references/tick', '/api/v1/library/tick']) {
    void fetch(`${base}${path}?brand=${encodeURIComponent(slug)}`, { method: 'POST', headers }).catch(swallow('encodeURIComponent failed'));
  }
}

// ── L'accensione ────────────────────────────────────────────────────────────────────────────────

// da chiamare da activate/+page.server.ts dopo la conferma del pagamento — UNA riga:
//   void igniteBrandTeam(brand.id);
/**
 * Accende la squadra di default di un brand appena passato a pagamento. Idempotente (vedi testa
 * del file). NON gate-a sul piano: l'ordine tra la scrittura di `brands.plan` e questa chiamata
 * non è garantito nel flusso di attivazione, e tutto ciò che fa è innocuo su un brand free —
 * i thread sono chat, il radar è una preferenza, e il primo giro sbatte comunque contro il gate
 * `scheduledWorkAllowed` dentro ogni tick (jobPausedForBrand → no_plan).
 */
export async function igniteBrandTeam(
  brandId: string,
  admin: SupabaseClient = createAdminClient()
): Promise<{ ignited: boolean; threadsCreated: number }> {
  const { data: brand } = await admin
    .from('brands')
    .select('id, slug, content_prefs')
    .eq('id', brandId)
    .maybeSingle();
  if (!brand) return { ignited: false, threadsCreated: 0 };

  // Radar: acceso di default, ma un "no" esplicito già salvato resta un no — l'accensione
  // abilita i default, non scavalca mai lo spegnimento di una persona.
  const prefs = (brand.content_prefs ?? {}) as Record<string, unknown>;
  const radar = (prefs.radar ?? null) as { enabled?: unknown; mode?: unknown; maxPerDay?: unknown } | null;
  if (typeof radar?.enabled !== 'boolean') {
    await admin
      .from('brands')
      .update({
        content_prefs: {
          ...prefs,
          radar: { ...(radar ?? {}), enabled: true, mode: radar?.mode ?? 'digest', maxPerDay: radar?.maxPerDay ?? 1 }
        }
      })
      .eq('id', brandId);
  }

  // Un thread per AGENTE che possiede almeno una routine (oggi: content, analyst, web), con il
  // suo messaggio di presentazione. ugc/motion/auto non hanno routine: il loro thread nasce alla
  // prima conversazione, non qui — meno thread vuoti in sidebar. Assenza di opt-out = routine già
  // accese: per i lavori del roster non c'è niente da flippare.
  let threadsCreated = 0;
  const owners = [...new Set(ROSTER_JOBS.map((job) => jobOwner(job.key)))];
  for (const agentId of owners) {
    const t = await getOrCreateTeamThread(admin, brandId, agentId);
    if (t?.created) threadsCreated++;
  }

  // Primo giro solo alla prima accensione vera: un replay del webhook non rilancia gli audit.
  if (threadsCreated > 0) kickFirstLap(String(brand.slug ?? ''));

  return { ignited: true, threadsCreated };
}
