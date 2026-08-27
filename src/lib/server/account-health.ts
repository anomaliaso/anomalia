import type { SupabaseClient } from '@supabase/supabase-js';

// Health monitor for connected social accounts (7/84 brands have them). Watches publish_logs:
// an account whose recent publish attempts fail persistently (>= MIN_FAILURES failures AND
// >= MIN_FAILURE_RATE of all its attempts in the window) is reported as `failing` and surfaced
// as a per-brand `account_failing` incident (deduped per brand+kind+day). No email — incidents
// + console.error only.

export type AccountHealthFinding = {
  social_account_id: string;
  brand_id: string;
  platform: string | null;
  failures: number;
  total: number;
  lastError: string | null;
};

export type PublishLogRow = {
  social_account_id: string | null;
  brand_id: string;
  platform: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

export const ACCOUNT_FAILING_KIND = 'account_failing';
const WINDOW_DAYS = 7;
const MIN_FAILURES = 3;
const MIN_FAILURE_RATE = 0.7;
// Window pagination (PostgREST truncates at max-rows) — page size and a sanity ceiling.
const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

/** Pure aggregation over publish_logs rows — exported for the unit test. */
export function summary(rows: PublishLogRow[]): AccountHealthFinding[] {
  const byAccount = new Map<
    string,
    { brand_id: string; platform: string | null; failures: number; total: number; lastError: string | null; lastTs: string }
  >();
  for (const row of rows) {
    if (!row.social_account_id) continue;
    let acc = byAccount.get(row.social_account_id);
    if (!acc) {
      acc = { brand_id: row.brand_id, platform: row.platform, failures: 0, total: 0, lastError: null, lastTs: '' };
      byAccount.set(row.social_account_id, acc);
    }
    acc.total += 1;
    if (row.status === 'failed') {
      acc.failures += 1;
      // Order-independent: the failure with the newest created_at wins.
      if (!acc.lastTs || row.created_at > acc.lastTs) {
        acc.lastTs = row.created_at;
        acc.lastError = row.error;
      }
    }
  }

  const failing: AccountHealthFinding[] = [];
  for (const [social_account_id, acc] of byAccount) {
    if (acc.failures >= MIN_FAILURES && acc.failures / acc.total >= MIN_FAILURE_RATE) {
      failing.push({
        social_account_id,
        brand_id: acc.brand_id,
        platform: acc.platform,
        failures: acc.failures,
        total: acc.total,
        lastError: acc.lastError
      });
    }
  }
  return failing;
}

/** Aggregate publish_logs from the last 7 days per social account; optionally scoped to one brand. */
export async function checkAccountHealth(
  admin: SupabaseClient,
  brandId?: string
): Promise<{ failing: AccountHealthFinding[] }> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  // PostgREST caps a response at its max-rows (1000): fleet-wide, 7 days of publish_logs is more
  // than that, so a single request returns the newest slice and every failure RATE is computed on
  // a partial window. Page through the window explicitly instead.
  // ponytail: fixed page walk, no cursor — 7 days of logs is small; revisit if the fleet grows.
  const rows: PublishLogRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = admin
      .from('publish_logs')
      .select('social_account_id, brand_id, platform, status, error, created_at')
      .not('social_account_id', 'is', null)
      .gte('created_at', since)
      // id breaks created_at ties: without a total order, paging can repeat or skip rows.
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (brandId) query = query.eq('brand_id', brandId);

    const { data, error } = await query;
    if (error) throw new Error(`publish_logs query failed: ${error.message}`);
    rows.push(...((data ?? []) as PublishLogRow[]));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }

  return { failing: summary(rows) };
}

/**
 * Upsert one `account_failing` incident per BRAND per day. Dedup is (brand_id, kind, detected_on) —
 * detected_on is GENERATED ALWAYS from detected_at (migration 0084, 428C9 if sent), so the
 * payload carries detected_at only. One upsert per finding used to make two broken accounts of the
 * same brand collide on that key, the second silently overwriting the first's details — so every
 * failing account of a brand now rides in the same row, under `details.accounts`.
 * Returns the number of incidents written (one per brand).
 */
export async function recordAccountIncidents(
  admin: SupabaseClient,
  findings: AccountHealthFinding[]
): Promise<number> {
  const byBrand = new Map<string, AccountHealthFinding[]>();
  for (const f of findings) {
    const list = byBrand.get(f.brand_id);
    if (list) list.push(f);
    else byBrand.set(f.brand_id, [f]);
  }

  let created = 0;
  for (const [brand_id, accounts] of byBrand) {
    const { error } = await admin.from('incidents').upsert(
      {
        brand_id,
        kind: ACCOUNT_FAILING_KIND,
        severity: 'warning',
        details: {
          accounts: accounts.map((f) => ({
            social_account_id: f.social_account_id,
            platform: f.platform,
            failures: f.failures,
            total: f.total,
            lastError: f.lastError
          }))
        },
        detected_at: new Date().toISOString()
      },
      { onConflict: 'brand_id,kind,detected_on' }
    );
    if (error) {
      console.error(`[account-health] incident upsert failed for brand ${brand_id}:`, error.message);
    } else {
      created += 1;
    }
  }
  return created;
}
