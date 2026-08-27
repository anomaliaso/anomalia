/**
 * Where a harvest's non-fatal failures go: the database, so they can be queried later, and Sentry,
 * so someone notices without going looking.
 *
 * WHY BOTH. The run log's jsonb answers "what happened in this tick". It cannot answer the question
 * you actually ask a week on — "which source has been failing, and since when?" — so each failure
 * also becomes a row. Sentry is the third thing: neither store pages anyone.
 *
 * SENTRY IS AGGREGATED, DELIBERATELY. The harvest runs hourly and a single dead endpoint produces
 * one failure per query per category per tick. Forwarding those one-by-one would push hundreds of
 * events a day for one broken thing, and the practical result of that is a muted Sentry project.
 * So failures are grouped by (stage, reason) and each group becomes ONE event carrying its count and
 * a few samples — which is also the shape you want to read.
 */
import * as Sentry from '@sentry/sveltekit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HarvestError } from '$lib/server/market-harvest';

/** Reason codes are emitted as a `code: detail` prefix; anything else groups under its first word. */
export function reasonOf(message: string): string {
  const text = String(message ?? '').trim();
  if (!text) return 'unknown';
  const colon = text.indexOf(':');
  const head = colon > 0 ? text.slice(0, colon) : text;
  return head.trim().split(/\s+/)[0].slice(0, 60).toLowerCase() || 'unknown';
}

export type ErrorGroup = {
  stage: string;
  reason: string;
  count: number;
  /** A few concrete targets, so the event is actionable without opening the database. */
  samples: string[];
};

/** Group failures by (stage, reason). Pure — this is what keeps Sentry readable. */
export function groupErrors(errors: HarvestError[], samplesPerGroup = 3): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const e of errors) {
    const reason = reasonOf(e.message);
    const key = `${e.stage}:${reason}`;
    const hit = groups.get(key);
    if (hit) {
      hit.count++;
      if (hit.samples.length < samplesPerGroup) hit.samples.push(e.target);
    } else {
      groups.set(key, { stage: e.stage, reason, count: 1, samples: [e.target] });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/**
 * Persist every failure and forward one aggregated event per group.
 *
 * Never throws: losing the error log must not lose the harvest that produced it. That would be a
 * particularly stupid way to turn observability into an outage.
 */
export async function reportHarvestErrors(
  admin: SupabaseClient,
  errors: HarvestError[],
  ctx: { runId?: string | null; categories?: string[] } = {}
): Promise<{ stored: number; groups: ErrorGroup[] }> {
  if (!errors.length) return { stored: 0, groups: [] };

  const rows = errors.slice(0, 1000).map((e) => ({
    run_id: ctx.runId ?? null,
    stage: e.stage,
    target: e.target?.slice(0, 500) ?? null,
    reason: reasonOf(e.message),
    message: e.message.slice(0, 1000)
  }));

  let stored = 0;
  try {
    const { error } = await admin.from('market_harvest_errors').insert(rows);
    if (error) console.error('[market-errors] insert failed:', error.message);
    else stored = rows.length;
  } catch (e) {
    console.error('[market-errors] insert threw:', e instanceof Error ? e.message : e);
  }

  const groups = groupErrors(errors);
  for (const g of groups) {
    try {
      Sentry.captureMessage(`[market-harvest] ${g.stage}: ${g.reason} ×${g.count}`, {
        // Non-fatal by construction — the harvest completed. Warning keeps these out of the
        // error feed while still being visible.
        level: 'warning',
        tags: { area: 'market-harvest', stage: g.stage, reason: g.reason },
        extra: {
          count: g.count,
          samples: g.samples,
          categories: ctx.categories ?? [],
          runId: ctx.runId ?? null
        }
      });
    } catch (e) {
      console.error('[market-errors] sentry capture failed:', e instanceof Error ? e.message : e);
    }
  }

  return { stored, groups };
}

/** The tick itself died. This one IS an exception — nothing was harvested. */
export function reportHarvestFatal(error: unknown, ctx: { categories?: string[] } = {}): void {
  try {
    Sentry.captureException(
      error instanceof Error ? error : new Error(`[market-harvest] ${String(error)}`),
      {
        level: 'error',
        tags: { area: 'market-harvest', stage: 'tick' },
        extra: { categories: ctx.categories ?? [] }
      }
    );
  } catch (e) {
    console.error('[market-errors] sentry capture failed:', e instanceof Error ? e.message : e);
  }
}
