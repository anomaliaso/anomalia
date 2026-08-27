import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACCOUNT_FAILING_KIND,
  checkAccountHealth,
  recordAccountIncidents,
  summary,
  type PublishLogRow
} from './account-health';

const ROW = (overrides: Partial<PublishLogRow> = {}): PublishLogRow => ({
  social_account_id: 'acc-1',
  brand_id: 'brand-1',
  platform: 'instagram',
  status: 'success',
  error: null,
  created_at: '2026-08-09T10:00:00.000Z',
  ...overrides
});

/** Thenable chainable builder: `.select().not().gte().order().range().eq()` → the page's rows. */
function healthClient(rows: PublishLogRow[]) {
  const eqCalls: unknown[] = [];
  const ranges: Array<{ from: number; to: number }> = [];
  const builder = {
    select: () => builder,
    not: () => builder,
    gte: () => builder,
    order: () => builder,
    range: (from: number, to: number) => {
      ranges.push({ from, to });
      return builder;
    },
    eq: (col: string, val: unknown) => {
      eqCalls.push({ col, val });
      return builder;
    },
    then: (resolve: (v: { data: PublishLogRow[]; error: null }) => void) => {
      const last = ranges[ranges.length - 1] ?? { from: 0, to: rows.length };
      return resolve({ data: rows.slice(last.from, last.to + 1), error: null });
    }
  };
  return {
    client: { from: () => builder } as unknown as SupabaseClient,
    eqCalls,
    ranges
  };
}

/** Captures the incidents upsert payloads. */
function incidentClient() {
  const calls: Array<{ payload: Record<string, unknown>; options: unknown }> = [];
  const client = {
    from: (table: string) => ({
      upsert: (payload: Record<string, unknown>, options: unknown) => {
        calls.push({ payload, options });
        return Promise.resolve({ error: null });
      }
    })
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('summary (pure aggregation over publish_logs)', () => {
  it('flags an account with >= 3 failures and >= 70% failure rate, with the newest failure error', () => {
    const rows = [
      ROW({ status: 'failed', error: 'zernio 401', created_at: '2026-08-09T10:00:00.000Z' }),
      ROW({ status: 'failed', error: 'zernio 401', created_at: '2026-08-08T10:00:00.000Z' }),
      ROW({ status: 'success', created_at: '2026-08-07T10:00:00.000Z' }),
      ROW({ status: 'failed', error: 'zernio 500', created_at: '2026-08-06T10:00:00.000Z' })
    ];
    const failing = summary(rows);
    expect(failing).toHaveLength(1);
    expect(failing[0]).toEqual({
      social_account_id: 'acc-1',
      brand_id: 'brand-1',
      platform: 'instagram',
      failures: 3,
      total: 4,
      lastError: 'zernio 401'
    });
  });

  it('is empty when failures < 3 even at high rate', () => {
    const rows = [
      ROW({ status: 'failed' }),
      ROW({ status: 'failed' }),
      ROW({ status: 'failed' })
    ];
    expect(summary(rows.slice(0, 2))).toEqual([]);
  });

  it('is empty when the failure rate is below 70% even with >= 3 failures', () => {
    const rows = [
      ROW({ status: 'failed' }),
      ROW({ status: 'failed' }),
      ROW({ status: 'failed' }),
      ROW({ status: 'success' }),
      ROW({ status: 'success' })
    ];
    expect(summary(rows)).toEqual([]);
  });

  it('aggregates per account and ignores rows with a null social_account_id', () => {
    const rows = [
      ROW({ social_account_id: 'acc-1', status: 'failed' }),
      ROW({ social_account_id: 'acc-1', status: 'failed' }),
      ROW({ social_account_id: 'acc-1', status: 'failed' }),
      ROW({ social_account_id: 'acc-2', brand_id: 'brand-2', platform: 'facebook', status: 'success' }),
      ROW({ social_account_id: null, status: 'failed' })
    ];
    const failing = summary(rows);
    expect(failing.map((f) => f.social_account_id)).toEqual(['acc-1']);
  });
});

describe('checkAccountHealth', () => {
  it('returns failing accounts from the query rows (>= 3 fail / >= 70%)', async () => {
    const { client } = healthClient([
      ROW({ status: 'failed' }),
      ROW({ status: 'failed' }),
      ROW({ status: 'failed' })
    ]);
    const { failing } = await checkAccountHealth(client);
    expect(failing).toHaveLength(1);
    expect(failing[0].failures).toBe(3);
  });

  it('returns no failing accounts below threshold', async () => {
    const { client } = healthClient([
      ROW({ status: 'failed' }),
      ROW({ status: 'success' })
    ]);
    const { failing } = await checkAccountHealth(client);
    expect(failing).toEqual([]);
  });

  it('scopes the query to the brand when brandId is passed', async () => {
    const { client, eqCalls } = healthClient([ROW({ status: 'success' })]);
    await checkAccountHealth(client, 'brand-7');
    expect(eqCalls).toContainEqual({ col: 'brand_id', val: 'brand-7' });
  });

  // PostgREST truncates at max-rows (1000): one request over a fleet-wide 7d window only sees the
  // newest slice, so the rate would be computed on a partial window.
  it('pages through a window larger than one PostgREST response', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) =>
      ROW({ social_account_id: `acc-${i % 3}`, status: i % 3 === 0 ? 'success' : 'failed' })
    );
    const { client, ranges } = healthClient(rows);
    const { failing } = await checkAccountHealth(client);
    expect(ranges.length).toBe(2);
    expect(ranges[0]).toEqual({ from: 0, to: 999 });
    // acc-0 is all-success; the other two accounts fail every attempt across the FULL window.
    expect(failing.map((f) => f.social_account_id).sort()).toEqual(['acc-1', 'acc-2']);
    expect(failing[0].total).toBe(500);
  });
});

describe('recordAccountIncidents', () => {
  it('upserts one incident per brand with dedup conflict and NO detected_on in the payload', async () => {
    const { client, calls } = incidentClient();
    const findings = [
      {
        social_account_id: 'acc-1',
        brand_id: 'brand-1',
        platform: 'instagram',
        failures: 3,
        total: 4,
        lastError: 'zernio 500'
      },
      {
        social_account_id: 'acc-2',
        brand_id: 'brand-2',
        platform: 'facebook',
        failures: 5,
        total: 6,
        lastError: null
      }
    ];

    const created = await recordAccountIncidents(client, findings);

    expect(created).toBe(2);
    expect(calls).toHaveLength(2);
    for (const { payload, options } of calls) {
      expect(payload).not.toHaveProperty('detected_on');
      expect(payload.brand_id).toBeDefined();
      expect(payload.kind).toBe(ACCOUNT_FAILING_KIND);
      expect(payload.severity).toBe('warning');
      expect(payload.detected_at).toBeDefined();
      expect(options).toEqual({ onConflict: 'brand_id,kind,detected_on' });
    }
    expect(calls[0].payload.brand_id).toBe('brand-1');
    expect(calls[0].payload.details).toEqual({
      accounts: [
        { social_account_id: 'acc-1', platform: 'instagram', failures: 3, total: 4, lastError: 'zernio 500' }
      ]
    });
  });

  // The dedup key is (brand_id, kind, detected_on): one upsert per finding made the second broken
  // account of a brand overwrite the first one's details.
  it('merges every failing account of the same brand into a single incident', async () => {
    const { client, calls } = incidentClient();
    const created = await recordAccountIncidents(client, [
      { social_account_id: 'acc-1', brand_id: 'brand-1', platform: 'instagram', failures: 3, total: 3, lastError: 'a' },
      { social_account_id: 'acc-2', brand_id: 'brand-1', platform: 'facebook', failures: 4, total: 4, lastError: 'b' }
    ]);

    expect(created).toBe(1);
    expect(calls).toHaveLength(1);
    expect((calls[0].payload.details as { accounts: unknown[] }).accounts).toHaveLength(2);
  });
});
