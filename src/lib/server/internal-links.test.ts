import { describe, it, expect, vi } from 'vitest';
import {
  findRelatedArticles,
  findRelatedSitePages,
  applyInternalLinks,
  runInternalLinkingTick,
  seeAlsoBlock,
  anchorFor
} from './internal-links';

// Mock the backlink-network only for the URL builder (needs env/brands/sites queries we don't
// want to fake); tokenize / tokenOverlap / suggestAnchor stay real — the matching under test
// is exactly the real token overlap logic.
vi.mock('./backlink-network', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./backlink-network')>();
  return {
    ...mod,
    publicArticleUrl: vi.fn(async (_admin: unknown, _brandId: string, slug: string) =>
      `https://example.com/${slug}`
    )
  };
});

vi.mock('./site-pages', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./site-pages')>();
  return {
    ...mod,
    resolveSitePagePublicUrl: vi.fn(async (_admin: unknown, _brandId: string, slug: string) =>
      `https://example.com/p/${slug}`
    )
  };
});

type Row = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const updates: Array<{ table: string; patch: Row }> = [];
  const updatesWhere: Array<Record<string, unknown>> = [];

  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('neq:')) {
        const val = row[k.slice(4)];
        // `.not(col, 'is', null)` → field must be present AND non-null
        return v === null ? val != null : val !== v;
      }
      if (k.startsWith('in:')) return (v as unknown[]).includes(row[k.slice(3)]);
      return row[k] === v;
    });

  // Emulate the PostgREST embed `blog_tags(name)`: attach the nested tag row by tag_id.
  const project = (rows: Row[], select: string) =>
    select.includes('blog_tags(')
      ? rows.map((r) => ({ ...r, blog_tags: (tables.blog_tags ?? []).find((t) => t.id === r.tag_id) ?? null }))
      : rows;

  function chain(table: string, start: { mode?: 'update' | 'insert'; patch?: Row } = {}) {
    const where: Record<string, unknown> = {};
    let insertedRow: Row | null = null;
    let selectCols = '';
    const q: Record<string, unknown> = {};
    q.select = (cols: string) => {
      selectCols = String(cols);
      return q;
    };
    q.eq = (k: string, v: unknown) => {
      where[k] = v;
      return q;
    };
    q.neq = (k: string, v: unknown) => {
      where[`neq:${k}`] = v;
      return q;
    };
    // PostgREST `.not(col, 'is', null)` → treat as `col IS NOT NULL`.
    q.not = (k: string, _op: string, v: unknown) => {
      where[`neq:${k}`] = v;
      return q;
    };
    q.in = (k: string, v: unknown[]) => {
      where[`in:${k}`] = v;
      return q;
    };
    q.order = () => q;
    q.limit = () => q;
    q.insert = (row: Row) => {
      insertedRow = { ...row, id: row.id ?? `id-${tables[table].length + 1}` };
      tables[table].push(insertedRow);
      return chain(table, { mode: 'insert' });
    };
    q.update = (patch: Row) => chain(table, { mode: 'update', patch });
    q.maybeSingle = async () => {
      if (start.mode === 'insert') return { data: insertedRow, error: null };
      const rows = project(tables[table].filter((r) => matches(r, where)), selectCols);
      return { data: rows[0] ?? null, error: null };
    };
    q.then = (resolve: (v: unknown) => void) => {
      if (start.mode === 'update') {
        for (const r of tables[table].filter((row) => matches(row, where))) Object.assign(r, start.patch);
        updates.push({ table, patch: start.patch ?? {} });
        updatesWhere.push(where);
        resolve({ data: null, error: null });
      } else if (start.mode === 'insert') {
        resolve({ data: insertedRow, error: null });
      } else {
        resolve({ data: project(tables[table].filter((r) => matches(r, where)), selectCols), error: null });
      }
    };
    return q;
  }

  const client = { from: (table: string) => chain(table) };
  return { client, tables, updates, updatesWhere };
}

// `overlapping` = which candidate articles share the source's 'Campeggio' tag (t1). a2 always
// gets an extra tag so it ranks FIRST among overlaps (tie-breaks are by id otherwise).
const seed = (overlapping: string[] = ['a2']) => ({
  brand_articles: [
    { id: 'a1', brand_id: 'b1', title: 'Guida completa al campeggio', slug: 'guida-campeggio', status: 'published', body_md: '# Intro\n\nTesto del primo articolo.' },
    { id: 'a2', brand_id: 'b1', title: 'Come scegliere una tenda da campeggio', slug: 'tenda-campeggio', status: 'published', body_md: 'Tenda.' },
    { id: 'a3', brand_id: 'b1', title: 'Ricette facili per la montagna', slug: 'ricette-montagna', status: 'published', body_md: 'Ricette.' },
    { id: 'a4', brand_id: 'b1', title: 'Lampade da campeggio a LED', slug: 'lampade-campeggio', status: 'published', body_md: 'Lampade.' },
    { id: 'a5', brand_id: 'b1', title: 'Zaini impermeabili per trekking', slug: 'zaini-trekking', status: 'published', body_md: 'Zaini.' },
    { id: 'a6', brand_id: 'b1', title: 'Sacco a pelo invernale', slug: 'sacco-pelo', status: 'published', body_md: 'Sacco.' },
    { id: 'a7', brand_id: 'b1', title: 'Bussola per orientamento', slug: 'bussola', status: 'published', body_md: 'Bussola.' },
    { id: 'a8', brand_id: 'b1', title: 'Bozza non ancora pubblicata', slug: 'bozza', status: 'draft', body_md: 'Bozza.' }
  ],
  brand_article_tags: [
    { article_id: 'a1', tag_id: 't1' },
    { article_id: 'a1', tag_id: 't2' },
    ...overlapping.map((id) => ({ article_id: id, tag_id: 't1' })),
    { article_id: 'a2', tag_id: 't5' },
    { article_id: 'a3', tag_id: 't3' },
    { article_id: 'a4', tag_id: 't3' },
    { article_id: 'a5', tag_id: 't4' },
    { article_id: 'a6', tag_id: 't4' },
    { article_id: 'a7', tag_id: 't3' }
  ],
  blog_tags: [
    { id: 't1', name: 'Campeggio' },
    { id: 't2', name: 'Outdoor' },
    { id: 't3', name: 'Montagna' },
    { id: 't4', name: 'Trekking' },
    { id: 't5', name: 'Tende' }
  ],
  brand_internal_links: [],
  blog_integrations: [],
  brand_site_pages: []
});

describe('findRelatedArticles', () => {
  it('ranks candidates by topic overlap and drops unrelated ones', async () => {
    const { client } = makeDb(seed());
    const related = await findRelatedArticles(client as never, 'b1', { id: 'a1', title: 'Guida campeggio' });
    expect(related.map((r) => r.id)).toEqual(['a2']);
    expect(related[0].score).toBeGreaterThan(0);
  });

  it('excludes the source itself and non-published articles', async () => {
    const { client } = makeDb(seed());
    const related = await findRelatedArticles(client as never, 'b1', { id: 'a1', title: 'Guida campeggio' });
    expect(related.some((r) => r.id === 'a1')).toBe(false);
    expect(related.some((r) => r.id === 'a8')).toBe(false);
  });
});

describe('applyInternalLinks', () => {
  it('appends the See also block at the END of body_md and records the pair', async () => {
    const db = makeDb(seed());
    const added = await applyInternalLinks(db.client as never, 'b1', 'a1');

    expect(added).toBe(1);
    const body = db.tables.brand_articles.find((a) => a.id === 'a1')?.body_md as string;
    expect(body.startsWith('# Intro\n\nTesto del primo articolo.')).toBe(true);
    expect(body.endsWith(seeAlsoBlock('Come scegliere una tenda da campeggio', 'https://example.com/tenda-campeggio'))).toBe(true);
    expect(db.tables.brand_internal_links).toEqual([
      expect.objectContaining({
        brand_id: 'b1',
        source_article_id: 'a1',
        target_article_id: 'a2',
        anchor_text: 'Come scegliere una tenda da campeggio'
      })
    ]);
  });

  it('never double-appends on a second run (dedup via registry)', async () => {
    const db = makeDb(seed());
    await applyInternalLinks(db.client as never, 'b1', 'a1');
    const added = await applyInternalLinks(db.client as never, 'b1', 'a1');

    expect(added).toBe(0);
    const body = db.tables.brand_articles.find((a) => a.id === 'a1')?.body_md as string;
    expect(body.split('See also').length - 1).toBe(1);
    expect(db.tables.brand_internal_links).toHaveLength(1);
  });

  it('respects the maxLinks cap', async () => {
    const db = makeDb(seed(['a2', 'a4', 'a5', 'a6']));
    const added = await applyInternalLinks(db.client as never, 'b1', 'a1', { maxLinks: 3 });

    expect(added).toBe(3);
    const body = db.tables.brand_articles.find((a) => a.id === 'a1')?.body_md as string;
    expect(body.split('> See also:').length - 1).toBe(3);
    expect(db.tables.brand_internal_links).toHaveLength(3);
  });

  it('skips a candidate the article already links to inline', async () => {
    const s = seed();
    s.brand_articles[0] = {
      ...s.brand_articles[0],
      body_md: '# Intro\n\nGià citata qui: [tenda](https://example.com/tenda-campeggio).'
    };
    const db = makeDb(s);
    const added = await applyInternalLinks(db.client as never, 'b1', 'a1');

    expect(added).toBe(0);
    expect(db.tables.brand_internal_links).toHaveLength(0);
  });
});

describe('runInternalLinkingTick', () => {
  it('gives every brand a slot and marks an unlinkable article as processed', async () => {
    const s = seed();
    // A second brand whose only article has no sibling to link to.
    s.brand_articles.push({
      id: 'z1', brand_id: 'b2', title: 'Motori diesel', slug: 'motori', status: 'published', body_md: 'Motori.'
    });
    const db = makeDb({
      ...s,
      brands: [
        { id: 'b1', slug: 'b1', plan: 'pro', status: 'active' },
        { id: 'b2', slug: 'b2', plan: 'pro', status: 'active' }
      ],
      brand_pages: [],
      brand_sites: [],
      brand_seo_keyword_strategy: []
    });

    const res = await runInternalLinkingTick(db.client as never, { maxArticles: 2 });

    // One article each — the first brand must not eat both slots.
    expect(res.articles).toBe(2);
    expect(db.tables.brand_internal_links.some((r) => r.source_article_id === 'a1')).toBe(true);
    // Zero links found → self-row marks it processed so it stops reoccupying a slot forever.
    expect(
      db.tables.brand_internal_links.some((r) => r.source_article_id === 'z1' && r.target_article_id === 'z1')
    ).toBe(true);
  });
});

describe('anchorFor', () => {
  it('reuses suggestAnchor and caps at ~60 chars', () => {
    expect(anchorFor({ title: 'Come scegliere una tenda da campeggio per ogni stagione' }).length).toBeLessThanOrEqual(60);
    expect(anchorFor({ title: '' })).toBe('this guide');
  });
});

describe('findRelatedSitePages', () => {
  it('ranks published landing pages by topic overlap with the source article', async () => {
    const db = makeDb({
      ...seed(),
      brand_site_pages: [
        { id: 'p1', brand_id: 'b1', slug: 'tende-campeggio', title: 'Le migliori tende da campeggio', kind: 'landing_page', status: 'published', target_query: 'tenda da campeggio' },
        { id: 'p2', brand_id: 'b1', slug: 'bussole', title: 'Bussola orientamento', kind: 'landing_page', status: 'published', target_query: 'bussola' },
        { id: 'p3', brand_id: 'b1', slug: 'bozza-landing', title: 'Tende da campeggio premium', kind: 'landing_page', status: 'draft', target_query: 'tenda' }
      ]
    });
    const found = await findRelatedSitePages(db.client as never, 'b1', 'a1');
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].id).toBe('p1');
    expect(found.some((p) => p.id === 'p3')).toBe(false); // draft excluded
  });

  it('returns [] when no landing overlaps', async () => {
    const db = makeDb({
      ...seed(),
      brand_site_pages: [
        { id: 'p9', brand_id: 'b1', slug: 'cucina', title: 'Ricette di cucina', kind: 'landing_page', status: 'published', target_query: 'ricette' }
      ]
    });
    const found = await findRelatedSitePages(db.client as never, 'b1', 'a1');
    expect(found).toEqual([]);
  });
});

describe('applyInternalLinks — landing targets', () => {
  const landingSeed = () => ({
    ...seed(),
    brand_site_pages: [
      { id: 'p1', brand_id: 'b1', slug: 'tende-campeggio', title: 'Le migliori tende da campeggio', kind: 'landing_page', status: 'published', target_query: 'tenda da campeggio' }
    ]
  });

  it('appends one landing link after the article links and records target_site_page_id', async () => {
    const db = makeDb(landingSeed());
    const added = await applyInternalLinks(db.client as never, 'b1', 'a1');
    // article link (a2) + landing link (p1)
    expect(added).toBe(2);
    const body = db.tables.brand_articles.find((a) => a.id === 'a1')?.body_md as string;
    expect(body).toContain('https://example.com/p/tende-campeggio');
    expect(db.tables.brand_internal_links).toEqual([
      expect.objectContaining({ source_article_id: 'a1', target_article_id: 'a2' }),
      expect.objectContaining({ source_article_id: 'a1', target_site_page_id: 'p1' })
    ]);
  });

  it('does not double-append the landing on a second run', async () => {
    const db = makeDb(landingSeed());
    await applyInternalLinks(db.client as never, 'b1', 'a1');
    const added = await applyInternalLinks(db.client as never, 'b1', 'a1');
    expect(added).toBe(0);
    const body = db.tables.brand_articles.find((a) => a.id === 'a1')?.body_md as string;
    expect(body.split('See also').length - 1).toBe(2);
  });
});
