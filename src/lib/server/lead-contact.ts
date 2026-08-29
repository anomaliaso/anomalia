import type { SupabaseClient } from '@supabase/supabase-js';
import { swallow } from './swallow';

export type LeadPlatform = 'reddit' | 'threads' | 'x' | 'linkedin' | 'web';

export type ContactGate = { suppressed: boolean; contacted: boolean };

export type SuppressSource = 'reply' | 'manual' | 'thread_scan';

// Una persona, un tocco: il frequency cap è globale per istanza, non per brand. Il prospect che
// ha già ricevuto un messaggio da UN cliente non viene mai più proposto a nessun altro.
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
  input: { platform: string; handle: string; source: SuppressSource; reason?: string }
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
    swallow('suppress author', e);
    return false;
  }
}

export function platformOf(url: string): LeadPlatform {
  const u = (url ?? '').toLowerCase();
  if (u.includes('reddit.com')) return 'reddit';
  if (u.includes('threads.net')) return 'threads';
  if (u.includes('x.com') || u.includes('twitter.com')) return 'x';
  if (u.includes('linkedin.com')) return 'linkedin';
  return 'web';
}

// Setaccio stretto di proposito: "stop" da solocompare in mezzo a frasi normali ("stop wasting
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
