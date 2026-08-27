import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildVisualInsights,
  currentWindowStart,
  learnLessons,
  loadMatchedOwnPosts,
  persistInsights,
  runVisualInsightsTick,
  sufficientData,
  type VisualInsightGroup
} from './visual-insights';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

type Builder = {
  select: () => Builder;
  eq: (col: string, val: unknown) => Builder;
  neq: () => Builder;
  is: () => Builder;
  or: () => Builder;
  in: () => Builder;
  gte: () => Builder;
  lte: () => Builder;
  lt: () => Builder;
  order: () => Builder;
  limit: () => Builder;
  ilike: (col: string, pattern: string) => Builder;
  update: () => Builder;
  insert: (payload: unknown) => Builder;
  upsert: (payload: unknown, options: unknown) => Builder;
  maybeSingle: () => Promise<{ data: AnyRec | null; error: null }>;
  then: (resolve: (v: { data: AnyRec[]; error: null }) => void) => Promise<void>;
};

/** Chainable thenable mock: returns the registered rows per table, captures writes. */
function mockClient(tables: Record<string, AnyRec[]>) {
  const fromCalls: string[] = [];
  const inserts: unknown[] = [];
  const upserts: Array<{ payload: unknown; options: unknown }> = [];

  const client = {
    from: (table: string): Builder => {
      fromCalls.push(table);
      const rows = tables[table] ?? [];
      let ilikePattern: string | null = null;
      const eqFilters: Array<{ col: string; val: unknown }> = [];
      const builder: Builder = {
        select: () => builder,
        eq: (col, val) => {
          eqFilters.push({ col, val });
          return builder;
        },
        neq: () => builder,
        is: () => builder,
        or: () => builder,
        in: () => builder,
        gte: () => builder,
        lte: () => builder,
        lt: () => builder,
        order: () => builder,
        limit: () => builder,
        ilike: (_col, pattern) => {
          ilikePattern = pattern;
          return builder;
        },
        update: () => builder,
        insert: (payload) => {
          inserts.push(payload);
          return builder;
        },
        upsert: (payload, options) => {
          upserts.push({ payload, options });
          return builder;
        },
        maybeSingle: () => {
          let list = rows;
          for (const f of eqFilters) {
            if (f.col === 'brand_id') list = list.filter((r) => r.brand_id === f.val);
            if (f.col === 'key') list = list.filter((r) => r.key === f.val);
          }
          if (ilikePattern) {
            const needle = ilikePattern.replace(/^%+|%+$/g, '');
            list = list.filter((r) => String(r.value ?? '').includes(needle));
          }
          return Promise.resolve({ data: list[0] ?? null, error: null });
        },
        then: (resolve) => Promise.resolve(resolve({ data: rows, error: null }))
      };
      return builder;
    }
  };

  return { client: client as unknown as SupabaseClient, fromCalls, inserts, upserts };
}

function metaRow(i: number, overrides: Partial<AnyRec> = {}): AnyRec {
  return {
    id: `meta-${i}`,
    post_id: `post-${i}`,
    brand_id: 'brand-1',
    platform: 'instagram',
    format: 'carousel',
    genre: 'produced_ugc',
    params: {},
    asset_source: 'ai_studio',
    hook_type: 'claim',
    published_at: '2026-08-05T10:00:00.000Z',
    ...overrides
  };
}

function postRow(i: number, overrides: Partial<AnyRec> = {}): AnyRec {
  return { id: `post-${i}`, external_post_id: `ext-${i}`, ...overrides };
}

function histRow(i: number, overrides: Partial<AnyRec> = {}): AnyRec {
  return {
    id: `hist-${i}`,
    external_post_id: `ext-${i}`,
    platform: 'instagram',
    published_at: '2026-08-05T10:05:00.000Z',
    metrics: { engagementRate: '4.2', likes: 10, comments: 2, impressions: 100 },
    ...overrides
  };
}

function readyTables(meta: AnyRec[] = [], posts: AnyRec[] = [], history: AnyRec[] = []) {
  return { post_visual_meta: meta, posts, social_post_history: history };
}

/**
 * 13 own posts in-window, 10 of them with a usable ER (the brand gate is on those): 6×
 * produced_ugc (ER '0' → fallback 14%), 4× raw_ugc (ER 4.2%), 3× cinematic (ER '0', no
 * impressions → ignored).
 */
function defaultReadyTables() {
  const meta = [] as AnyRec[];
  const posts = [] as AnyRec[];
  const history = [] as AnyRec[];
  for (let i = 1; i <= 6; i++) {
    meta.push(metaRow(i, { genre: 'produced_ugc' }));
    posts.push(postRow(i));
    history.push(histRow(i, { metrics: { engagementRate: '0', likes: 10, comments: 2, impressions: 100 } }));
  }
  for (let i = 7; i <= 10; i++) {
    meta.push(metaRow(i, { genre: 'raw_ugc' }));
    posts.push(postRow(i));
    history.push(histRow(i, { metrics: { engagementRate: '4.2' } }));
  }
  for (let i = 11; i <= 13; i++) {
    meta.push(metaRow(i, { genre: 'cinematic' }));
    posts.push(postRow(i));
    history.push(histRow(i, { metrics: { engagementRate: '0' } }));
  }
  return readyTables(meta, posts, history);
}

const GROUP = (overrides: Partial<VisualInsightGroup> = {}): VisualInsightGroup => ({
  dimension: 'genre',
  value: 'produced_ugc',
  n: 5,
  er_avg: 14,
  delta: 50,
  ...overrides
});

describe('sufficientData thresholds', () => {
  it('returns ready with ≥ 10 own posts matched', async () => {
    const { client } = mockClient(defaultReadyTables());
    const res = await sufficientData(client, 'brand-1');
    expect(res.count).toBe(13);
    expect(res.status).toBe('ready');
  });

  it('returns seeding (no insights, no error) with 3-9 posts', async () => {
    const meta = [1, 2, 3, 4, 5].map((i) => metaRow(i));
    const { client } = mockClient(readyTables(meta, meta.map((m) => postRow(Number(m.post_id.slice(5)))), meta.map((m) => histRow(Number(m.post_id.slice(5))))));
    const res = await sufficientData(client, 'brand-1');
    expect(res.count).toBe(5);
    expect(res.status).toBe('seeding');
  });

  it('returns insufficient below 3 posts', async () => {
    const meta = [1, 2].map((i) => metaRow(i));
    const { client } = mockClient(readyTables(meta, meta.map((m) => postRow(Number(m.post_id.slice(5)))), meta.map((m) => histRow(Number(m.post_id.slice(5))))));
    const res = await sufficientData(client, 'brand-1');
    expect(res.status).toBe('insufficient');
  });

  it('is insufficient when meta exists but no zernio history joins', async () => {
    const meta = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => metaRow(i));
    const posts = meta.map((m) => postRow(Number(m.post_id.slice(5))));
    const { client } = mockClient(readyTables(meta, posts, []));
    const res = await sufficientData(client, 'brand-1');
    expect(res.count).toBe(0);
    expect(res.status).toBe('insufficient');
  });
});

describe('buildVisualInsights (ER computation, errata P2#7)', () => {
  it("uses engagementRate when present, falls back on '0', ignores rows with neither", async () => {
    const { client } = mockClient(defaultReadyTables());
    const groups = await buildVisualInsights(client, 'brand-1');

    const produced = groups.find((g) => g.dimension === 'genre' && g.value === 'produced_ugc');
    const raw = groups.find((g) => g.dimension === 'genre' && g.value === 'raw_ugc');
    const cinematic = groups.find((g) => g.dimension === 'genre' && g.value === 'cinematic');
    expect(produced).toBeDefined();
    expect(produced!.n).toBe(6);
    // fallback: (likes + 2*comments) / impressions, on the same PERCENT scale as engagementRate
    expect(produced!.er_avg).toBeCloseTo(14, 6);
    expect(raw).toBeDefined();
    expect(raw!.n).toBe(4);
    expect(raw!.er_avg).toBeCloseTo(4.2, 6);
    expect(cinematic).toBeUndefined(); // engagementRate '0' and no impressions → ignored

    // brand mean over the 10 valid rows: (6*14 + 4*4.2) / 10 = 10.08 (percent)
    const brandMean = (6 * 14 + 4 * 4.2) / 10;
    // delta is in percentage points, not a fraction
    expect(raw!.delta).toBeCloseTo(((4.2 - brandMean) / brandMean) * 100, 4);
    expect(produced!.delta).toBeCloseTo(((14 - brandMean) / brandMean) * 100, 4);
    expect(produced!.delta).toBeGreaterThan(30);

    // no group under the 3-post threshold survives
    expect(groups.every((g) => g.n >= 3)).toBe(true);
  });

  it('drops groups with n < 3', async () => {
    const t = defaultReadyTables();
    const meta = [...t.post_visual_meta];
    const posts = [...t.posts];
    const history = [...t.social_post_history];
    meta[0] = metaRow(1, { genre: 'produced_ugc', platform: 'tiktok' });
    meta[1] = metaRow(2, { genre: 'produced_ugc', platform: 'tiktok' });
    posts[0] = postRow(1);
    posts[1] = postRow(2);
    history[0] = histRow(1, { platform: 'tiktok', metrics: { engagementRate: '0', likes: 10, comments: 2, impressions: 100 } });
    history[1] = histRow(2, { platform: 'tiktok', metrics: { engagementRate: '0', likes: 10, comments: 2, impressions: 100 } });
    const { client } = mockClient(readyTables(meta, posts, history));

    const groups = await buildVisualInsights(client, 'brand-1');
    const tiktok = groups.find((g) => g.dimension === 'platform' && g.value === 'tiktok');
    const instagram = groups.find((g) => g.dimension === 'platform' && g.value === 'instagram');
    expect(tiktok).toBeUndefined();
    expect(instagram!.n).toBe(8);
  });

  it('returns [] with fewer than 10 own posts (brand gate)', async () => {
    const meta = [1, 2, 3, 4, 5].map((i) => metaRow(i));
    const { client } = mockClient(readyTables(meta, meta.map((m) => postRow(Number(m.post_id.slice(5)))), meta.map((m) => histRow(Number(m.post_id.slice(5))))));
    expect(await buildVisualInsights(client, 'brand-1')).toEqual([]);
  });

  it('applies the brand gate AFTER dropping rows without a usable ER', async () => {
    // 12 matched posts but only 3 carry an ER → no significance, no winners.
    const meta = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => metaRow(i));
    const posts = meta.map((m) => postRow(Number(m.post_id.slice(5))));
    const history = meta.map((m, idx) =>
      histRow(Number(m.post_id.slice(5)), {
        metrics: idx < 3 ? { engagementRate: '4.2' } : { engagementRate: '0' }
      })
    );
    const { client } = mockClient(readyTables(meta, posts, history));
    expect(await sufficientData(client, 'brand-1')).toEqual({ count: 12, status: 'ready' });
    expect(await buildVisualInsights(client, 'brand-1')).toEqual([]);
  });
});

describe('join fallback (errata P2#4)', () => {
  it('retries by (platform, published_at ±1 day) when the external_post_id join yields < 3', async () => {
    const meta = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => metaRow(i));
    // Only 2 posts carry an external_post_id → primary join yields 2 (< 3) → fallback.
    const posts = [postRow(1), postRow(2)];
    // All history rows are within ±1 day of the meta published_at → every meta row matches
    // a distinct history row on (platform, date).
    const history = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) =>
      histRow(i, { published_at: '2026-08-05T09:00:00.000Z' })
    );
    const { client, fromCalls } = mockClient(readyTables(meta, posts, history));

    const res = await sufficientData(client, 'brand-1');
    expect(res.count).toBe(12);
    expect(res.status).toBe('ready');
    expect(fromCalls.filter((t) => t === 'social_post_history')).toHaveLength(2); // ext-id query + window query
  });

  it('does not match history rows more than 1 day away', async () => {
    const meta = [metaRow(1), metaRow(2)];
    const history = [
      histRow(1, { published_at: '2026-08-05T09:00:00.000Z' }), // within ±1 day → matched
      histRow(2, { published_at: '2026-08-09T09:00:00.000Z' }) // 4 days off → not matched
    ];
    // No external_post_id on the posts → the time-window fallback is the only path.
    const { client } = mockClient(readyTables(meta, [], history));
    const rows = await loadMatchedOwnPosts(client, 'brand-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].meta.id).toBe('meta-1');
  });

  it('keeps the external_post_id matches when the fallback finds fewer', async () => {
    const meta = [metaRow(1), metaRow(2)];
    const posts = [postRow(1), postRow(2)];
    // Same external ids (id join matches both) but another platform → the fallback matches none.
    const history = [histRow(1, { platform: 'linkedin' }), histRow(2, { platform: 'linkedin' })];
    const { client } = mockClient(readyTables(meta, posts, history));
    const rows = await loadMatchedOwnPosts(client, 'brand-1');
    expect(rows).toHaveLength(2);
  });

  it('pairs each meta row with the CLOSEST history row in time', async () => {
    const meta = [
      metaRow(1, { published_at: '2026-08-05T10:00:00.000Z' }),
      metaRow(2, { published_at: '2026-08-05T18:00:00.000Z' })
    ];
    // No external_post_id anywhere → straight to the time-window fallback.
    const history = [
      histRow(1, { published_at: '2026-08-05T17:50:00.000Z', metrics: { engagementRate: '9' } }),
      histRow(2, { published_at: '2026-08-05T10:05:00.000Z', metrics: { engagementRate: '4.2' } })
    ];
    const { client } = mockClient(readyTables(meta, [], history));
    const rows = await loadMatchedOwnPosts(client, 'brand-1');
    expect(rows).toHaveLength(2);
    expect(rows[0].metrics?.engagementRate).toBe('4.2'); // 10:00 → 10:05, not 17:50
    expect(rows[1].metrics?.engagementRate).toBe('9');
  });
});

describe('currentWindowStart (stable Monday window, errata P2#3)', () => {
  it('returns the Monday of the current week for any weekday', () => {
    expect(currentWindowStart(new Date('2026-08-10T12:00:00Z'))).toBe('2026-08-10'); // Mon
    expect(currentWindowStart(new Date('2026-08-12T12:00:00Z'))).toBe('2026-08-10'); // Wed
    expect(currentWindowStart(new Date('2026-08-16T12:00:00Z'))).toBe('2026-08-10'); // Sun
  });

  it('is stable across consecutive runs (same day)', () => {
    expect(currentWindowStart(new Date('2026-08-12T00:00:01Z'))).toBe(
      currentWindowStart(new Date('2026-08-12T23:59:59Z'))
    );
  });
});

describe('persistInsights (upsert with stable window)', () => {
  it('upserts on the unique key with the Monday window_start', async () => {
    const { client, upserts } = mockClient({});
    const groups = [GROUP()];
    const n = await persistInsights(client, 'brand-1', groups);
    expect(n).toBe(1);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].options).toEqual({ onConflict: 'brand_id,window_start,dimension,value' });
    expect(upserts[0].payload).toEqual([
      {
        brand_id: 'brand-1',
        window_start: currentWindowStart(),
        dimension: 'genre',
        value: 'produced_ugc',
        n: 5,
        er_avg: 14,
        delta: 50
      }
    ]);
  });

  it('writes the same window_start on repeated runs (real conflict → overwrite)', async () => {
    const { client, upserts } = mockClient({});
    await persistInsights(client, 'brand-1', [GROUP()]);
    await persistInsights(client, 'brand-1', [GROUP({ n: 7, er_avg: 20 })]);
    const first = upserts[0].payload as AnyRec[];
    const second = upserts[1].payload as AnyRec[];
    expect(upserts).toHaveLength(2);
    expect(first[0].window_start).toBe(second[0].window_start);
  });
});

describe('learnLessons (top-2 above +15%, idempotent)', () => {
  it('writes only groups with delta > 15 points, capped at 2, sorted by delta', async () => {
    const { client, inserts } = mockClient({ brand_memory: [] });
    const groups = [
      GROUP({ dimension: 'genre', value: 'produced_ugc', delta: 50 }),
      GROUP({ dimension: 'asset_source', value: 'ai_studio', delta: 40 }),
      GROUP({ dimension: 'platform', value: 'instagram', delta: 20 }),
      GROUP({ dimension: 'hook_type', value: 'claim', delta: 10 }),
      GROUP({ dimension: 'genre', value: 'raw_ugc', delta: -30 })
    ];
    const n = await learnLessons(client, 'brand-1', groups);
    expect(n).toBe(2);
    const keys = inserts.map((i) => (i as AnyRec).key).sort();
    expect(keys).toEqual(['visual.asset_source.ai_studio', 'visual.genre.produced_ugc']);
    const first = inserts[0] as AnyRec;
    expect(first.category).toBe('insight');
    expect(first.source).toBe('analysis');
    expect(first.layer).toBe('project');
    expect(first.confidence).toBe(0.75);
    expect(first.value).toContain('Visual insight: produced_ugc per genre → +50% ER vs media brand (n=5)');
  });

  it('refreshes an existing lesson instead of leaving it frozen', async () => {
    const { client, inserts } = mockClient({
      brand_memory: [
        {
          id: 'm1',
          brand_id: 'brand-1',
          key: 'visual.genre.produced_ugc',
          confidence: 0.75,
          times_reinforced: 0,
          value: 'Visual insight: produced_ugc per genre → +50% ER vs media brand (n=5)'
        }
      ]
    });
    const groups = [
      GROUP({ value: 'produced_ugc', delta: 22 }),
      GROUP({ dimension: 'asset_source', value: 'ai_studio', delta: 40 })
    ];
    const n = await learnLessons(client, 'brand-1', groups);
    expect(n).toBe(2); // both handled: one updated in place, one inserted
    expect(inserts).toHaveLength(1);
    expect((inserts[0] as AnyRec).key).toBe('visual.asset_source.ai_studio');
  });

  it('writes nothing when no group is above the threshold', async () => {
    const { client, inserts } = mockClient({ brand_memory: [] });
    const n = await learnLessons(client, 'brand-1', [GROUP({ delta: 10 }), GROUP({ delta: 15 })]);
    expect(n).toBe(0);
    expect(inserts).toHaveLength(0);
  });
});

describe('runVisualInsightsTick', () => {
  it('stops at the sufficiency gate (seeding) without persisting', async () => {
    const meta = [1, 2, 3, 4, 5].map((i) => metaRow(i));
    const { client, upserts } = mockClient(
      readyTables(meta, meta.map((m) => postRow(Number(m.post_id.slice(5)))), meta.map((m) => histRow(Number(m.post_id.slice(5)))))
    );
    const res = await runVisualInsightsTick(client, 'brand-1');
    expect(res).toEqual({ ok: true, sufficient: 'seeding', groups: 0, lessons: 0 });
    expect(upserts).toHaveLength(0);
  });

  it('persists buckets and writes lessons when data is sufficient', async () => {
    const { client, upserts, inserts, fromCalls } = mockClient(defaultReadyTables());
    const res = await runVisualInsightsTick(client, 'brand-1');
    expect(res.ok).toBe(true);
    expect(res.sufficient).toBe('ready');
    expect(res.groups).toBeGreaterThan(0);
    expect(res.lessons).toBe(1); // only genre/produced_ugc (+39%) is above +15 points
    expect(upserts).toHaveLength(1);
    const payload = upserts[0].payload as AnyRec[];
    expect(payload.every((r) => r.window_start === currentWindowStart())).toBe(true);
    expect(inserts.some((i) => (i as AnyRec).key === 'visual.genre.produced_ugc')).toBe(true);
    // losing buckets stay persisted — the readers filter them, the writer does not
    expect(payload.some((r) => Number(r.delta) < 0)).toBe(true);
    // the join is loaded once, not once per phase
    expect(fromCalls.filter((t) => t === 'post_visual_meta')).toHaveLength(1);
  });
});
