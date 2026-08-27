/**
 * Il centro notifiche del brand, lato server — per gli AGENTI.
 *
 * La campanella della sidebar mostra due famiglie di voci:
 *  1. warning CALCOLATI (`computeBrandWarnings`, pure) — stato derivato, nessuna riga a DB,
 *    si "risolvono" da soli quando la condizione sparisce. Il layout li calcola per la UI;
 *    qui li ricalcoliamo con la STESSA funzione pura per la chat (prompt + read_notifications),
 *    così le due liste non possono divergere nelle regole — solo nell'istante della lettura.
 *  2. notifiche scritte dagli AGENTI — righe persistenti nella tabella `incidents` già esistente
 *    (migration 0084), marcate `kind = 'agent:<topic>'` e `details.source = 'agent'`. Nessuna
 *    tabella nuova: incidents ha già severità, dedup (brand+kind+giorno), `resolved_at` e RLS
 *    service-role. Il topic è la chiave stabile di dedup: MAI due righe aperte per lo stesso topic.
 *
 * ponytail: le query di `loadBrandWarnings` duplicano il gathering di
 * src/routes/app/[brand]/+layout.server.ts (loadDeferred) invece di estrarlo — lì le stesse query
 * alimentano anche badge/quota/studioPct e il refactor toccherebbe un file caldo condiviso.
 * Se le due liste divergono, il posto da riallineare è QUESTO file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeBrandWarnings, type AppWarning } from '$lib/warnings';
import { canConnectSocials } from '$lib/plans';
import { countCalendarConflicts } from '$lib/server/schedule';
import { remaining } from '$lib/server/usage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** Prefisso che separa le notifiche degli agenti dai kind di sistema in `incidents`. */
export const AGENT_NOTICE_PREFIX = 'agent:';
/**
 * Tetto di notifiche agente APERTE per brand. Il valore della campanella è la scarsità: la lista
 * calcolata porta già ~5–15 voci, cinque slot agente bastano per "cose che aspettano la persona"
 * e obbligano a risolvere prima di aggiungere.
 */
export const MAX_OPEN_AGENT_NOTICES = 5;

/** `error` è VOLUTAMENTE assente: gli errori sono fatti di sistema, non giudizi di un agente. */
export type AgentNoticeSeverity = 'indication' | 'warning';

export type AgentNotice = {
  id: string;
  topic: string;
  severity: AgentNoticeSeverity;
  title: string;
  message: string;
  thread_id: string | null;
  detected_at: string;
};

/** Chiave stabile: minuscole, trattini, niente rumore — così lo stesso argomento collide sempre. */
export function normalizeTopic(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function rowToNotice(row: AnyRec): AgentNotice {
  const d = (row.details ?? {}) as AnyRec;
  return {
    id: String(row.id),
    topic: String(row.kind ?? '').slice(AGENT_NOTICE_PREFIX.length),
    severity: row.severity === 'warning' ? 'warning' : 'indication',
    title: String(d.title ?? ''),
    message: String(d.message ?? ''),
    thread_id: typeof d.thread_id === 'string' ? d.thread_id : null,
    detected_at: String(row.detected_at ?? '')
  };
}

/** Le notifiche agente APERTE del brand, più recenti prima. Fail-soft: qualsiasi errore → []. */
export async function listAgentNotices(
  admin: SupabaseClient,
  brandId: string,
  limit = 50
): Promise<AgentNotice[]> {
  try {
    const { data, error } = await admin
      .from('incidents')
      .select('id, kind, severity, details, detected_at')
      .eq('brand_id', brandId)
      .like('kind', `${AGENT_NOTICE_PREFIX}%`)
      .is('resolved_at', null)
      .order('detected_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []).map(rowToNotice);
  } catch {
    return [];
  }
}

/**
 * Una notifica agente resa come AppWarning per la campanella. Titolo/messaggio sono testo libero
 * dell'agente, ma il renderer traduce CHIAVI i18n: le chiavi `warnings.agentNote.*` valgono
 * "{text}" in ogni lingua, e il testo viaggia come VALORE di interpolazione (i valori non vengono
 * ri-parsati come ICU, quindi il testo libero è sicuro). L'href è il thread da cui è nata:
 * la notifica è l'invito, il thread è il contesto.
 */
export function agentNoticeToWarning(n: AgentNotice, base: string): AppWarning {
  return {
    id: `agent-${n.id}`,
    severity: n.severity === 'warning' ? 'warning' : 'suggestion',
    title: 'warnings.agentNote.title',
    message: 'warnings.agentNote.msg',
    values: { text: n.title, message: n.message },
    href: n.thread_id ? `${base}/chat/${n.thread_id}` : undefined
  };
}

export type UpsertNoticeResult =
  | { status: 'created' | 'updated'; topic: string; open_count: number }
  | { status: 'cap_reached'; topic: string; open_count: number; max: number }
  | { status: 'error'; message: string };

/**
 * Scrive (o aggiorna) UNA notifica agente. Dedup per topic: se esiste già una riga APERTA con lo
 * stesso `agent:<topic>` si aggiorna quella — mai un doppione. Se il topic è nuovo ma il brand ha
 * già MAX_OPEN_AGENT_NOTICES aperte, si rifiuta: prima si risolve, poi si aggiunge.
 */
export async function upsertAgentNotice(
  admin: SupabaseClient,
  args: {
    brandId: string;
    topic: string;
    severity: AgentNoticeSeverity;
    title: string;
    message: string;
    threadId?: string | null;
    /**
     * Salta il tetto di notifiche aperte. Il tetto esiste per impedire agli AGENTI di riempire la
     * campanella di opinioni; un controllo di sistema che ha trovato una deriva di fatturazione
     * non è un'opinione, e non deve poter essere scartato in silenzio perché il brand aveva già
     * cinque note aperte. Un allarme sui soldi che nessuno vede è il bug che stiamo chiudendo.
     */
    bypassCap?: boolean;
  }
): Promise<UpsertNoticeResult> {
  const topic = normalizeTopic(args.topic);
  if (!topic) return { status: 'error', message: 'topic must contain letters or digits' };
  const kind = `${AGENT_NOTICE_PREFIX}${topic}`;
  const details = {
    source: 'agent',
    title: args.title,
    message: args.message,
    thread_id: args.threadId ?? null
  };
  try {
    const { data: open, error: readErr } = await admin
      .from('incidents')
      .select('id')
      .eq('brand_id', args.brandId)
      .eq('kind', kind)
      .is('resolved_at', null)
      .limit(1)
      .maybeSingle();
    if (readErr) return { status: 'error', message: readErr.message };

    if (open?.id) {
      const { error } = await admin
        .from('incidents')
        .update({ severity: args.severity, details, detected_at: new Date().toISOString() })
        .eq('id', open.id);
      if (error) return { status: 'error', message: error.message };
      const open_count = await countOpenNotices(admin, args.brandId);
      return { status: 'updated', topic, open_count };
    }

    const open_count = await countOpenNotices(admin, args.brandId);
    if (!args.bypassCap && open_count >= MAX_OPEN_AGENT_NOTICES) {
      return { status: 'cap_reached', topic, open_count, max: MAX_OPEN_AGENT_NOTICES };
    }

    // Upsert sulla unique (brand,kind,detected_on): se OGGI esiste già una riga risolta dello
    // stesso topic, la si riapre invece di violare il vincolo — è la stessa notifica che torna vera.
    const { error } = await admin.from('incidents').upsert(
      {
        brand_id: args.brandId,
        kind,
        severity: args.severity,
        details,
        detected_at: new Date().toISOString(),
        resolved_at: null
      },
      { onConflict: 'brand_id,kind,detected_on' }
    );
    if (error) return { status: 'error', message: error.message };
    return { status: 'created', topic, open_count: open_count + 1 };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

async function countOpenNotices(admin: SupabaseClient, brandId: string): Promise<number> {
  const { count } = await admin
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .like('kind', `${AGENT_NOTICE_PREFIX}%`)
    .is('resolved_at', null);
  return count ?? 0;
}

/** Chiude la notifica aperta di un topic. `resolved: false` = non c'era niente da chiudere. */
export async function resolveAgentNotice(
  admin: SupabaseClient,
  brandId: string,
  topic: string
): Promise<{ resolved: boolean; error?: string }> {
  const kind = `${AGENT_NOTICE_PREFIX}${normalizeTopic(topic)}`;
  try {
    const { data, error } = await admin
      .from('incidents')
      .update({ resolved_at: new Date().toISOString() })
      .eq('brand_id', brandId)
      .eq('kind', kind)
      .is('resolved_at', null)
      .select('id');
    if (error) return { resolved: false, error: error.message };
    return { resolved: (data ?? []).length > 0 };
  } catch (e) {
    return { resolved: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// True quando gtm_plans.phases ha almeno una fase — copia 1:1 dal layout (vedi nota in testa).
function gtmPhasesHaveContent(phases: unknown): boolean {
  if (Array.isArray(phases)) return phases.length > 0;
  if (phases && typeof phases === 'object') {
    const o = phases as Record<string, unknown>;
    return (
      (Array.isArray(o.horizon_90d) && o.horizon_90d.length > 0) ||
      (Array.isArray(o.horizon_6m) && o.horizon_6m.length > 0)
    );
  }
  return false;
}

const AUTOPILOT_MAX_FAILURES = 3; // rispecchia scheduler.ts MAX_CONSECUTIVE_FAILURES

/**
 * La stessa lista della campanella, ricalcolata per la chat. `brand` è la riga del brand
 * (serve: id, slug, plan, status, timezone, target_platforms, content_prefs, blog_config,
 * autopilot_failure_count, onboarding_completed_at).
 */
export async function loadBrandWarnings(supabase: SupabaseClient, brand: AnyRec): Promise<AppWarning[]> {
  const brandId = brand.id as string;
  const [
    { count: pendingCount },
    { count: failedPostCount },
    { count: attentionPostCount },
    { data: generatedPosts },
    { data: connectedAccts },
    { data: gtmPlans },
    { data: editPlans },
    { data: linkedContentPlans },
    { count: proposedGtmCount },
    { count: proposedEditCount },
    { count: peopleCount },
    { count: competitorCount },
    { count: geoAuditCount },
    { data: kit },
    { data: strategyRow },
    budget
  ] = await Promise.all([
    supabase.from('posts').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'pending_user'),
    supabase.from('posts').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'failed'),
    supabase.from('posts').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('needs_attention', true).neq('status', 'published'),
    supabase.from('posts').select('platform, status, scheduled_for, slot').eq('brand_id', brandId).in('status', ['pending_user', 'approved', 'scheduled']),
    supabase.from('social_accounts').select('platform, status').eq('brand_id', brandId),
    supabase.from('gtm_plans').select('id, phases').eq('brand_id', brandId).eq('status', 'active'),
    supabase.from('editorial_plans').select('id, weeks, strategy').eq('brand_id', brandId).eq('status', 'active'),
    supabase.from('content_plans').select('id').eq('brand_id', brandId).not('editorial_plan_id', 'is', null).limit(1),
    supabase.from('gtm_plans').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'proposed'),
    supabase.from('editorial_plans').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'proposed'),
    supabase.from('people').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('competitors').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('brand_geo_audits').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('brand_kit').select('logos, visual_style').eq('brand_id', brandId).maybeSingle(),
    supabase.from('brand_strategy').select('report').eq('brand_id', brandId).maybeSingle(),
    remaining(supabase, brandId, brand.plan as string | null, (brand.timezone as string) || 'Europe/Rome', brand as AnyRec)
  ]);

  const norm = (p: unknown) => String(p ?? '').toLowerCase();
  const connectedPlatforms = [...new Set((connectedAccts ?? []).filter((a) => a.status === 'active').map((a) => norm(a.platform)).filter(Boolean))];
  const brokenPlatforms = [...new Set((connectedAccts ?? []).filter((a) => ['expired', 'error', 'disconnected'].includes(String(a.status ?? ''))).map((a) => norm(a.platform)).filter(Boolean))].filter((p) => !connectedPlatforms.includes(p));
  const contentPlatforms = [...new Set((generatedPosts ?? []).map((p) => norm(p.platform)).filter(Boolean))];
  const strategyReport = (strategyRow?.report as AnyRec) ?? null;
  const strategyPlatforms: string[] | null = Array.isArray(strategyReport?.platformGuidance)
    ? strategyReport.platformGuidance.map((g: AnyRec) => String(g?.platform ?? '')).filter(Boolean)
    : null;
  const planStrategy = ((editPlans ?? [])[0] as AnyRec)?.strategy ?? null;
  const editorialPlanPlatforms: string[] | null = Array.isArray(planStrategy?.platform_mix)
    ? planStrategy.platform_mix.map((m: AnyRec) => String(m?.platform ?? '')).filter(Boolean)
    : null;
  const prefs = (brand.content_prefs as AnyRec) ?? {};
  const hasLinkedPlans = (linkedContentPlans ?? []).length > 0;

  return computeBrandWarnings({
    base: `/app/${brand.slug}`,
    canConnectSocials: canConnectSocials((brand.plan as string | null) ?? null, (brand.status as string) || 'trial'),
    targetPlatforms: Array.isArray(brand.target_platforms) ? (brand.target_platforms as string[]) : [],
    connectedPlatforms,
    brokenPlatforms,
    autopilotFailureCount: (brand as { autopilot_failure_count?: number }).autopilot_failure_count ?? 0,
    autopilotMaxFailures: AUTOPILOT_MAX_FAILURES,
    hasProposedPlan: (proposedGtmCount ?? 0) > 0 || (proposedEditCount ?? 0) > 0,
    strategyPlatforms,
    editorialPlanPlatforms,
    contentPlatforms,
    contentCount: (generatedPosts ?? []).length,
    failedPostCount: failedPostCount ?? 0,
    attentionPostCount: attentionPostCount ?? 0,
    postsRemaining: budget.posts,
    postsQuota: budget.postsQuota,
    hasStrategy: (gtmPlans ?? []).some((p) => gtmPhasesHaveContent((p as { phases?: unknown }).phases)),
    hasEditorialPlan:
      hasLinkedPlans &&
      (editPlans ?? []).some((p: { weeks?: unknown[] | null }) => Array.isArray(p.weeks) && p.weeks.length > 0),
    onboardingCompleted: !!(brand as { onboarding_completed_at?: string | null }).onboarding_completed_at,
    pendingCount: pendingCount ?? 0,
    calendarConflicts: countCalendarConflicts(
      (generatedPosts ?? []) as { scheduled_for: string | null; status: string; slot: string | null }[],
      (brand.timezone as string) || 'Europe/Rome'
    ),
    hasLogo: (((kit?.logos ?? []) as AnyRec[]) ?? []).some((l) => l?.url && l?.type !== 'og-image'),
    hasVisualStyle: !!(kit?.visual_style as string | null | undefined)?.trim(),
    hasHashtags: !!prefs.platformHashtags && Object.keys(prefs.platformHashtags).length > 0,
    peopleCount: peopleCount ?? 0,
    competitorCount: competitorCount ?? 0,
    blogEnabled: (brand.blog_config as { enabled?: boolean } | null)?.enabled === true,
    hasGeoAudit: (geoAuditCount ?? 0) > 0
  });
}

const SEV_ORDER: Record<string, number> = { error: 0, warning: 1, suggestion: 2 };

/**
 * Il blocco NOTIFICATIONS del system prompt: la stessa lista della campanella, taggata per
 * severità, con tetto duro — il punto è la consapevolezza, non il dump (per la lista completa
 * c'è read_notifications). Le voci calcolate escono come id+valori (auto-esplicativi e neutri
 * rispetto alla lingua); le notifiche degli agenti col loro testo libero, più recenti prima.
 */
export function renderNotificationsBlock(
  warnings: AppWarning[],
  notices: AgentNotice[],
  cap = 10
): string {
  const noticeIds = new Set(notices.map((n) => `agent-${n.id}`));
  const computed = warnings
    .filter((w) => !noticeIds.has(w.id))
    .sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  const lines: string[] = [];
  // Le notifiche agente prima (sono poche, hanno un timestamp e sono "tue"), poi le calcolate
  // in ordine di gravità, finché il tetto regge.
  for (const n of notices) {
    if (lines.length >= cap) break;
    lines.push(
      `- [${n.severity}] (agent, ${n.detected_at.slice(0, 10)}) ${n.topic}: ${n.title} — ${n.message.slice(0, 200)}`
    );
  }
  for (const w of computed) {
    if (lines.length >= cap) break;
    const vals = w.values ? ` ${JSON.stringify(w.values)}` : '';
    lines.push(`- [${w.severity}] ${w.id}${vals}${w.href ? ` → ${w.href}` : ''}`);
  }
  const total = notices.length + computed.length;
  if (total === 0) return '';
  return `## NOTIFICATIONS (live — the user's sidebar bell shows this same list)
Open now: ${total}${total > lines.length ? ` (showing ${lines.length} — call read_notifications for all)` : ''}
${lines.join('\n')}
Entries marked (agent) were written by an agent via set_notification; resolve them with set_notification{resolve:true} the moment they stop being true.`;
}
