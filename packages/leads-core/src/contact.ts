/**
 * Una persona, un tocco.
 *
 * Il frequency cap è GLOBALE per istanza, non per brand: il prospect che ha già ricevuto un
 * messaggio da UN cliente non viene mai più proposto a nessun altro. È la ragione per cui
 * `lead_suppressions` non ha `brand_id` — chi lo aggiunge rompe la promessa.
 *
 * L'errore non si riporta da qui: il package non conosce il reporter dell'app, quindi `report`
 * entra come dipendenza e di default finisce solo in console.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type LeadPlatform = 'reddit' | 'threads' | 'x' | 'linkedin' | 'web';

export type ContactGate = { suppressed: boolean; contacted: boolean };

export type SuppressSource = 'reply' | 'manual' | 'thread_scan';

export type ReportError = (reason: string, err: unknown) => void;

const reportToConsole: ReportError = (reason, err) => {
  console.error(`[swallowed] ${reason}:`, err instanceof Error ? err.message : String(err));
};

export async function contactGate(
  admin: SupabaseClient,
  platform: string,
  handle: string
): Promise<ContactGate> {
  const { data: hit } = await admin
    .from('lead_suppressions')
    .select('handle')
    .eq('platform', platform)
    .eq('handle', handle)
    .maybeSingle();
  if (hit) return { suppressed: true, contacted: false };

  const { data: past } = await admin
    .from('brand_news_items')
    .select('id')
    .eq('author_platform', platform)
    .eq('author_handle', handle)
    .or('status.eq.posted,done_at.not.is.null')
    .limit(1);
  return { suppressed: false, contacted: (past?.length ?? 0) > 0 };
}

export function gateVerdict(gate: ContactGate): 'suppressed' | 'contacted' | 'ok' {
  if (gate.suppressed) return 'suppressed';
  if (gate.contacted) return 'contacted';
  return 'ok';
}

export async function suppressAuthor(
  admin: SupabaseClient,
  input: { platform: string; handle: string; source: SuppressSource; reason?: string },
  report: ReportError = reportToConsole
): Promise<boolean> {
  try {
    const { error } = await admin
      .from('lead_suppressions')
      .upsert(
        { platform: input.platform, handle: input.handle, source: input.source, reason: input.reason ?? null },
        { onConflict: 'platform,handle', ignoreDuplicates: true }
      );
    if (error) {
      console.warn('[lead-contact] suppress:', error.message.slice(0, 120));
      return false;
    }
    return true;
  } catch (e) {
    report('suppress author', e);
    return false;
  }
}

/** Dove si raggiunge l'autore, per piattaforma: l'umano apre l'URL e manda il DM a mano. */
export function authorProfileUrl(url: string, author: string): string {
  if (!author) return '';
  if (url.includes('threads.net')) return `https://www.threads.net/@${author.replace(/^@/, '')}`;
  if (url.includes('x.com') || url.includes('twitter.com')) return `https://x.com/${author.replace(/^@/, '')}`;
  // LinkedIn authors are display names, not handles → no derivable profile URL; open the post itself.
  if (url.includes('linkedin.com')) return url;
  return `https://www.reddit.com/user/${author.replace(/^u\//, '')}`;
}

export function platformOf(url: string): LeadPlatform {
  const u = (url ?? '').toLowerCase();
  if (u.includes('reddit.com')) return 'reddit';
  if (u.includes('threads.net')) return 'threads';
  if (u.includes('x.com') || u.includes('twitter.com')) return 'x';
  if (u.includes('linkedin.com')) return 'linkedin';
  return 'web';
}

// Setaccio stretto di proposito: "stop" da solo compare in mezzo a frasi normali ("stop wasting
// time"), quindi ogni regola vuole il verbo di contatto accanto al segnale.
const OPT_OUT_RULES: RegExp[] = [
  /\b(?:do\s?not|don'?t)\s+(?:contact|message|dm|write|email)\b/i,
  /\bstop\s+(?:contacting|messaging|dm(?:ing)?|writing|emailing|replying)\b/i,
  /\bnon\s+(?:contattarmi|scrivermi|mandarmi)\b/i,
  /\bsmett\w*\s+di\s+(?:contattarmi|scrivermi|mandarmi)\b/i,
  /\bunsubscribe\b|\bopt[-\s]?out\b|\brimuovimi\b/i
];

export function isOptOutSignal(text: string | null | undefined): boolean {
  const raw = (text ?? '').trim();
  if (raw.length < 10) return false;
  return OPT_OUT_RULES.some((re) => re.test(raw));
}

export const DM_OPT_OUT_LINE = '(Reply "stop" and we won\'t reach out again.)';

export function dmWithOptOut(dm: string): string {
  const clean = (dm ?? '').trim();
  if (!clean) return '';
  if (clean.toLowerCase().includes('stop')) return clean;
  return `${clean}\n\n${DM_OPT_OUT_LINE}`;
}

// Retention (giorni): il contenuto derivato dal post è il dato delicato — 14 giorni e poi nulla.
// La riga minima (permalink, handle, stato) tiene 90 giorni ma SOLO per i lead non convertiti: un
// 'done' è storia del rapporto e ancora gli outcome. Esiti 12 mesi, telemetria di scansione 90.
const GIST_RETENTION_DAYS = 14;
const UNCONVERTED_LEAD_DAYS = 90;
const OUTCOME_RETENTION_DAYS = 365;
const SCAN_TELEMETRY_DAYS = 90;
const UNCONVERTED_STATUSES = ['proposed', 'suggested', 'skipped', 'dismissed'];

export async function sweepLeadRetention(
  admin: SupabaseClient,
  report: ReportError = reportToConsole
): Promise<void> {
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  // I builder Supabase sono thenable ma non promesse: niente .catch — il try sta qua.
  const quiet = async (what: string, run: () => unknown) => {
    try {
      await run();
    } catch (e) {
      report(`lead retention: ${what}`, e);
    }
  };

  await quiet('gist purge', () =>
    admin.from('brand_news_items').update({ gist: null }).lt('created_at', daysAgo(GIST_RETENTION_DAYS)).not('gist', 'is', null));
  await quiet('unconverted rows', () =>
    admin.from('brand_news_items').delete().lt('created_at', daysAgo(UNCONVERTED_LEAD_DAYS)).in('status', UNCONVERTED_STATUSES).is('done_at', null));
  await quiet('outcomes', () =>
    admin.from('lead_outcomes').delete().lt('checked_at', daysAgo(OUTCOME_RETENTION_DAYS)));
  await quiet('scan telemetry', () =>
    admin.from('radar_searches').delete().lt('created_at', daysAgo(SCAN_TELEMETRY_DAYS)));
}
