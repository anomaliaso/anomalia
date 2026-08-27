/**
 * Rolling chat-only credit windows (Command Code–style), separate from the monthly plan quota.
 * Only `ai_calls` rows billed as chat turns count — autopilot / tools / blog stay on the monthly
 * ceiling alone.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { FREE_CREDITS, PLANS } from '$lib/plans';

const CREDITS_PER_USD = 100;
const FIVE_H_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Labels that count toward chat windows (turn LLM + compaction). */
const CHAT_LABELS = ['chat', 'chatCompact'] as const;

export type ChatRateWindow = '5h' | 'week';

export type ChatRateLimits = {
  /** Max chat credits in any rolling 5 hours. */
  fiveHour: number;
  /** Max chat credits in any rolling 7 days. */
  weekly: number;
};

/**
 * Free is more generous in % (trial must feel usable). Paid ≈ Command Code 30% / 50% of monthly
 * credits. Absolute numbers stay in sync with Plan.credits / FREE_CREDITS.
 */
export function chatRateLimits(plan: string | null | undefined): ChatRateLimits {
  const monthly = PLANS.find((p) => p.key === plan)?.credits ?? FREE_CREDITS;
  if (!plan || plan === '') {
    return {
      fiveHour: Math.round(FREE_CREDITS * 0.5), // 200
      weekly: Math.round(FREE_CREDITS * 0.8) // 320
    };
  }
  // Unknown / legacy scale → Pro-sized windows (generous, not unlimited).
  if (plan === 'scale') {
    const pro = PLANS.find((p) => p.key === 'pro')!.credits;
    return { fiveHour: Math.round(pro * 0.3), weekly: Math.round(pro * 0.5) };
  }
  return {
    fiveHour: Math.round(monthly * 0.3),
    weekly: Math.round(monthly * 0.5)
  };
}

export type ChatRateUsage = {
  used5h: number;
  usedWeek: number;
  limits: ChatRateLimits;
  ok: boolean;
  /** Which window blocks, if any. */
  blocked: ChatRateWindow | null;
  /** When the sliding window drops below the limit — shown as "Puoi riprendere alle HH:MM". */
  resetAt: Date | null;
};

function creditsFromRows(rows: { cost_usd: number | string | null; created_at: string }[]): number {
  return Math.round(
    rows.reduce((sum, r) => sum + Number(r.cost_usd ?? 0) * CREDITS_PER_USD, 0)
  );
}

/**
 * Earliest time the sliding window drops below `limit`: walk calls oldest→newest; when call i
 * ages out (created_at + windowMs), remaining = total − prefix. First moment remaining < limit.
 */
export function resumeAtForWindow(
  rows: { cost_usd: number | string | null; created_at: string }[],
  limit: number,
  windowMs: number,
  now: Date = new Date()
): Date {
  const sorted = [...rows]
    .map((r) => ({
      at: Date.parse(r.created_at),
      credits: Math.round(Number(r.cost_usd ?? 0) * CREDITS_PER_USD)
    }))
    .filter((r) => Number.isFinite(r.at) && r.credits > 0)
    .sort((a, b) => a.at - b.at);

  if (!sorted.length) return new Date(now.getTime() + windowMs);

  let remaining = sorted.reduce((s, r) => s + r.credits, 0);
  if (remaining < limit) return now;

  for (const row of sorted) {
    remaining -= row.credits;
    const candidate = row.at + windowMs;
    if (remaining < limit) {
      return new Date(Math.max(candidate, now.getTime()));
    }
  }
  // All current window spend must age out.
  return new Date(sorted[sorted.length - 1]!.at + windowMs);
}

/**
 * Sum chat-labeled spend in rolling 5h + 7d windows. Fail-open on query errors (don't brick chat).
 */
export async function getChatRateUsage(
  supabase: SupabaseClient,
  brandId: string,
  plan: string | null | undefined,
  now: Date = new Date()
): Promise<ChatRateUsage> {
  const limits = chatRateLimits(plan);
  const weekStart = new Date(now.getTime() - WEEK_MS);

  const { data, error } = await supabase
    .from('ai_calls')
    .select('cost_usd, created_at')
    .eq('brand_id', brandId)
    .in('label', [...CHAT_LABELS])
    .gte('created_at', weekStart.toISOString())
    .not('cost_usd', 'is', null);

  if (error) {
    console.warn('[chat-rate-limits] query failed:', error.message);
    return {
      used5h: 0,
      usedWeek: 0,
      limits,
      ok: true,
      blocked: null,
      resetAt: null
    };
  }

  const rows = data ?? [];
  const fiveStart = now.getTime() - FIVE_H_MS;
  const rows5h = rows.filter((r) => Date.parse(r.created_at) >= fiveStart);
  const used5h = creditsFromRows(rows5h);
  const usedWeek = creditsFromRows(rows);

  let blocked: ChatRateWindow | null = null;
  let resetAt: Date | null = null;

  if (used5h >= limits.fiveHour) {
    blocked = '5h';
    resetAt = resumeAtForWindow(rows5h, limits.fiveHour, FIVE_H_MS, now);
  } else if (usedWeek >= limits.weekly) {
    blocked = 'week';
    resetAt = resumeAtForWindow(rows, limits.weekly, WEEK_MS, now);
  }

  return {
    used5h,
    usedWeek,
    limits,
    ok: blocked == null,
    blocked,
    resetAt
  };
}

/** Format like Command Code: "14:30" or "8 ago 14:30" if not today. */
function formatResumeAt(at: Date, locale: 'en' | 'it', now: Date = new Date()): string {
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  const time = at.toLocaleTimeString(locale === 'it' ? 'it-IT' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit'
  });
  if (sameDay) return time;
  const day = at.toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-GB', {
    day: 'numeric',
    month: 'short'
  });
  return `${day}, ${time}`;
}

/** Human message for the chat UI (locale from Accept-Language). */
export function chatRateLimitMessage(
  usage: ChatRateUsage,
  locale: 'en' | 'it',
  now: Date = new Date()
): string {
  const when = usage.resetAt ? formatResumeAt(usage.resetAt, locale, now) : null;

  if (usage.blocked === '5h') {
    return locale === 'it'
      ? `Hai raggiunto il limite chat delle ultime 5 ore (${usage.limits.fiveHour} crediti).${when ? ` Puoi riprendere alle ${when}.` : ''} Oppure passa a un piano superiore.`
      : `You've hit the 5-hour chat limit (${usage.limits.fiveHour} credits).${when ? ` You can resume at ${when}.` : ''} Or upgrade your plan.`;
  }
  return locale === 'it'
    ? `Hai raggiunto il limite chat settimanale (${usage.limits.weekly} crediti).${when ? ` Puoi riprendere alle ${when}.` : ''} Oppure passa a un piano superiore.`
    : `You've hit the weekly chat limit (${usage.limits.weekly} credits).${when ? ` You can resume at ${when}.` : ''} Or upgrade your plan.`;
}

export function chatRateLimitResponse(usage: ChatRateUsage, locale: 'en' | 'it'): Response {
  const message = chatRateLimitMessage(usage, locale);
  return new Response(
    JSON.stringify({
      error: 'chat_rate_limit',
      window: usage.blocked,
      message,
      used5h: usage.used5h,
      usedWeek: usage.usedWeek,
      limits: usage.limits,
      resetAt: usage.resetAt?.toISOString() ?? null
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json',
        ...(usage.resetAt ? { 'retry-after': String(Math.max(1, Math.ceil((usage.resetAt.getTime() - Date.now()) / 1000))) } : {})
      }
    }
  );
}

/**
 * Il tetto mensile del piano, non la finestra rotante: due freni diversi, e la chat aveva solo
 * questo secondo. `gateCredits` non era chiamata da nessun percorso di chat — il system prompt
 * chiedeva al modello di fermarsi da solo, che è un suggerimento, non un gate — e un brand a quota
 * finita pagava comunque l'intero giro dell'agente, finché per caso un tool non toccava un
 * chokepoint. True = niente crediti, il chiamante risponde 402 `credits_exhausted` (stessa forma
 * del render motion, così il client la riconosce già). Fail-open come `gateCredits`: un guasto al
 * billing non spegne la chat.
 */
export async function chatCreditsBlocked(brandId: string): Promise<boolean> {
  const { gateCredits, CreditsExhaustedError } = await import('$lib/server/credits');
  try {
    await gateCredits(brandId);
    return false;
  } catch (e) {
    if (e instanceof CreditsExhaustedError) return true;
    throw e;
  }
}
