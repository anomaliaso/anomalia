import { describe, it, expect } from 'vitest';
import { CONTENT_FORMATS } from '$lib/content-formats';
import { KIT_FORMATS } from '@anomalia/api-contracts';
import { CREATION_KIT_MAX_BYTES, buildCreationKit, type KitJob } from './creation-kit';

type Row = Record<string, unknown>;

// A supabase double that actually APPLIES the .eq() filters, so "another brand's material never
// appears" is proven by the same mechanism the real client uses, not by a mock that agrees.
function fakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q = {
        select: () => q,
        eq(column: string, value: unknown) {
          rows = rows.filter((r) => r[column] === value);
          return q;
        },
        in(column: string, values: unknown[]) {
          rows = rows.filter((r) => values.includes(r[column]));
          return q;
        },
        gte(column: string, value: string) {
          rows = rows.filter((r) => String(r[column] ?? '') >= value);
          return q;
        },
        order: () => q,
        limit(n: number) {
          rows = rows.slice(0, n);
          return q;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null })
      };
      return q;
    }
  };
}

const BRAND = {
  id: 'brand-1',
  name: 'Caffè Nero',
  slug: 'caffe-nero',
  timezone: 'Europe/Rome',
  target_platforms: ['instagram', 'linkedin'],
  content_prefs: {}
};

const OTHER = 'brand-2';

function job(over: Partial<KitJob> = {}): KitJob {
  return { goal: 'launch the new espresso grinder', platforms: ['linkedin'], format: 'text_post', ...over };
}

function tables(over: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    brand_kit: [],
    products: [],
    people: [],
    rubrics: [],
    social_post_history: [],
    editorial_plans: [],
    posts: [],
    ...over
  };
}

describe('il creation kit seleziona invece di svuotare la libreria', () => {
  it('porta un solo template, scelto per il formato richiesto', async () => {
    const kit = await buildCreationKit(fakeSupabase(tables()) as never, BRAND as never, job({ format: 'carousel' }));

    expect(kit.template?.group).toBe('Instagram Templates');
    expect(kit.template?.name).toBe('The Carousel Hook');
    expect(JSON.stringify(kit)).not.toContain('The Story Post');
  });

  it('il formato batte il goal: un video non riceve la struttura di un carosello', async () => {
    const clip = 'show the tasting bench in a short clip';
    const video = await buildCreationKit(
      fakeSupabase(tables()) as never,
      BRAND as never,
      job({ goal: clip, platforms: ['instagram'], format: 'video' })
    );
    const carousel = await buildCreationKit(
      fakeSupabase(tables()) as never,
      BRAND as never,
      job({ goal: clip, platforms: ['instagram'], format: 'carousel' })
    );

    expect(video.template?.name).toBe('The Reel Script');
    expect(carousel.template?.name).toBe('The Carousel Hook');
  });

  it('il goal sceglie fra i template dello stesso gruppo', async () => {
    const contrarian = await buildCreationKit(
      fakeSupabase(tables()) as never,
      BRAND as never,
      job({ goal: 'state an unpopular opinion about agency retainers' })
    );
    const story = await buildCreationKit(
      fakeSupabase(tables()) as never,
      BRAND as never,
      job({ goal: 'tell the lesson we learned when the roaster broke down' })
    );

    expect(contrarian.template?.name).toBe('The Contrarian Take');
    expect(story.template?.name).not.toBe('The Contrarian Take');
  });

  it('il playbook copre solo le piattaforme richieste', async () => {
    const kit = await buildCreationKit(
      fakeSupabase(tables()) as never,
      BRAND as never,
      job({ platforms: ['linkedin'] })
    );

    expect(kit.template?.playbook.toLowerCase()).toContain('linkedin');
    expect(kit.template?.playbook.toLowerCase()).not.toContain('tiktok');
    expect(kit.constraints.platforms.map((p) => p.platform)).toEqual(['linkedin']);
  });

  it('tiene solo le rubriche del formato richiesto', async () => {
    const rubrics = [
      { id: 'r-carousel', brand_id: BRAND.id, status: 'approved', name: 'Dietro le quinte', format: 'carousel', art_direction: 'reportage' },
      { id: 'r-text', brand_id: BRAND.id, status: 'approved', name: 'Lettere dal lab', format: 'text_post' }
    ];
    const kit = await buildCreationKit(
      fakeSupabase(tables({ rubrics })) as never,
      BRAND as never,
      job({ format: 'text_post' })
    );

    expect(kit.rubric?.id).toBe('r-text');
    expect(JSON.stringify(kit)).not.toContain('Dietro le quinte');
  });

  it('classifica i prodotti sul goal invece di elencarli tutti', async () => {
    const products = Array.from({ length: 30 }, (_, i) => ({
      id: `p-${i}`,
      brand_id: BRAND.id,
      title: `Filtro carta misura ${i}`,
      pricing: '4 €'
    }));
    products.push({ id: 'p-grinder', brand_id: BRAND.id, title: 'Espresso grinder Mk II', pricing: '890 €' });

    const kit = await buildCreationKit(fakeSupabase(tables({ products })) as never, BRAND as never, job());

    expect(kit.brand?.products?.[0]?.id).toBe('p-grinder');
    expect(kit.brand?.products?.length).toBeLessThanOrEqual(5);
  });
});

const HUGE = 'parola '.repeat(4000);

// A brand that maxes out every capped field at once — the only shape that can still overflow the
// budget once the per-field caps have done their work.
function maximalTables() {
  return tables({
    brand_kit: [{ brand_id: BRAND.id, about: HUGE, target_audience: HUGE }],
    products: Array.from({ length: 200 }, (_, i) => ({ id: `p-${i}`, brand_id: BRAND.id, title: HUGE, pricing: HUGE })),
    people: Array.from({ length: 10 }, (_, i) => ({ id: `pe-${i}`, brand_id: BRAND.id, name: HUGE, role: HUGE, consent: true })),
    rubrics: [
      { id: 'r-text', brand_id: BRAND.id, status: 'approved', name: 'Lettere', format: 'text_post', promise: HUGE, cadence: HUGE, art_direction: HUGE }
    ],
    editorial_plans: [{ brand_id: BRAND.id, status: 'active', weeks: [{ index: 0, week_start: '2020-01-06', theme: HUGE }] }],
    posts: Array.from({ length: 20 }, (_, i) => ({
      id: `po-${i}`,
      brand_id: BRAND.id,
      status: 'approved',
      scheduled_for: `2099-01-0${(i % 9) + 1}T09:00:00.000Z`,
      platform: 'linkedin',
      campaign_name: HUGE,
      campaign_step: HUGE
    })),
    social_post_history: Array.from({ length: 60 }, (_, i) => ({
      id: `h-${i}`,
      brand_id: BRAND.id,
      source: 'zernio',
      platform: 'linkedin',
      content: `${HUGE} #tag${i}`,
      media_type: 'image',
      published_at: `2026-08-0${(i % 9) + 1}T0${i % 9}:00:00.000Z`,
      metrics: { likes: i, comments: i }
    }))
  });
}

const MAXIMAL_PREFS = {
  language: 'italiano',
  avoid: Array.from({ length: 30 }, (_, i) => `parolaccia-${i}`),
  captionEditPairs: [
    { before: HUGE, after: HUGE },
    { before: HUGE, after: HUGE },
    { before: HUGE, after: HUGE }
  ]
};

describe('il creation kit resta dentro il budget', () => {
  it('non supera il tetto e cede per prime le sezioni meno autorevoli', async () => {
    const kit = await buildCreationKit(
      fakeSupabase(maximalTables()) as never,
      { ...BRAND, content_prefs: MAXIMAL_PREFS } as never,
      job()
    );

    expect(kit.budget_bytes).toBe(CREATION_KIT_MAX_BYTES);
    expect(Buffer.byteLength(JSON.stringify(kit), 'utf8')).toBeLessThanOrEqual(CREATION_KIT_MAX_BYTES);
    expect(kit.size_bytes).toBeLessThanOrEqual(CREATION_KIT_MAX_BYTES);
    expect(kit.trimmed.length).toBeGreaterThan(0);
    expect(kit.trimmed[0]).toBe('history');
  });

  it('i vincoli di piattaforma e i fatti del brand non vengono mai sacrificati', async () => {
    const kit = await buildCreationKit(
      fakeSupabase(maximalTables()) as never,
      { ...BRAND, content_prefs: MAXIMAL_PREFS } as never,
      job({ platforms: ['x'] })
    );

    expect(kit.constraints.platforms[0]).toMatchObject({ platform: 'x', char_limit: 280 });
    expect(kit.brand?.name).toBe('Caffè Nero');
    expect(kit.trimmed).not.toContain('constraints');
    expect(kit.trimmed).not.toContain('brand');
  });

  it('un brand normale non perde niente per il budget', async () => {
    const kit = await buildCreationKit(
      fakeSupabase(
        tables({
          brand_kit: [{ brand_id: BRAND.id, about: 'Torrefazione a Trieste dal 1998.', target_audience: 'Bar indipendenti.' }],
          products: [{ id: 'p-1', brand_id: BRAND.id, title: 'Espresso grinder Mk II', pricing: '890 €' }],
          rubrics: [{ id: 'r-text', brand_id: BRAND.id, status: 'approved', name: 'Lettere dal lab', format: 'text_post' }]
        })
      ) as never,
      BRAND as never,
      job()
    );

    expect(kit.trimmed).toEqual([]);
    expect(kit.size_bytes).toBeLessThan(CREATION_KIT_MAX_BYTES);
  });
});

describe('il creation kit è tracciabile e chiuso sul brand', () => {
  it('ogni pezzo selezionato porta un identificatore stabile e la versione delle regole', async () => {
    const kit = await buildCreationKit(
      fakeSupabase(
        tables({
          rubrics: [{ id: 'r-text', brand_id: BRAND.id, status: 'approved', name: 'Lettere', format: 'text_post' }],
          social_post_history: [
            {
              id: 'h-win',
              brand_id: BRAND.id,
              source: 'zernio',
              platform: 'linkedin',
              content: 'Il grinder che abbiamo rotto tre volte.',
              media_type: 'image',
              published_at: '2026-08-01T09:00:00.000Z',
              metrics: { likes: 90, comments: 20 }
            }
          ]
        })
      ) as never,
      BRAND as never,
      job()
    );

    expect(kit.versions.kit).toBeGreaterThan(0);
    expect(kit.template?.id).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
    expect(kit.rubric?.id).toBe('r-text');
    expect(kit.history?.winners[0]?.id).toBe('h-win');
  });

  it('nomina solo le persone che la regola del likeness lascia passare', async () => {
    const people = [
      { id: 'pe-real-no', brand_id: BRAND.id, name: 'Volto Senza Consenso', kind: 'real', consent: false },
      { id: 'pe-real-yes', brand_id: BRAND.id, name: 'Marta Rossi', kind: 'real', consent: true },
      { id: 'pe-ai', brand_id: BRAND.id, name: 'Persona AI', kind: 'ai', consent: false }
    ];
    const kit = await buildCreationKit(fakeSupabase(tables({ people })) as never, BRAND as never, job());

    expect(kit.brand?.people?.map((p) => p.id).sort()).toEqual(['pe-ai', 'pe-real-yes']);
    expect(JSON.stringify(kit)).not.toContain('Volto Senza Consenso');
  });

  it('non fa entrare il materiale di un altro brand', async () => {
    const kit = await buildCreationKit(
      fakeSupabase(
        tables({
          brand_kit: [{ brand_id: OTHER, about: 'SEGRETO-ALTRUI', target_audience: 'SEGRETO-ALTRUI' }],
          products: [{ id: 'p-x', brand_id: OTHER, title: 'SEGRETO-ALTRUI espresso grinder' }],
          people: [{ id: 'pe-x', brand_id: OTHER, name: 'SEGRETO-ALTRUI', consent: true }],
          rubrics: [{ id: 'r-x', brand_id: OTHER, status: 'approved', name: 'SEGRETO-ALTRUI', format: 'text_post' }],
          social_post_history: [
            {
              id: 'h-x',
              brand_id: OTHER,
              source: 'zernio',
              platform: 'linkedin',
              content: 'SEGRETO-ALTRUI',
              published_at: '2026-08-01T09:00:00.000Z',
              metrics: { likes: 900 }
            }
          ],
          editorial_plans: [{ brand_id: OTHER, status: 'active', weeks: [{ index: 0, week_start: '2026-09-01', theme: 'SEGRETO-ALTRUI' }] }],
          posts: [{ id: 'po-x', brand_id: OTHER, scheduled_for: '2099-01-01T09:00:00.000Z', campaign_name: 'SEGRETO-ALTRUI', status: 'approved' }]
        })
      ) as never,
      BRAND as never,
      job()
    );

    expect(JSON.stringify(kit)).not.toContain('SEGRETO-ALTRUI');
  });

  it('un brand appena creato produce un kit piccolo e coerente, non un muro di null', async () => {
    const kit = await buildCreationKit(fakeSupabase(tables()) as never, BRAND as never, job());

    expect(kit.constraints.platforms.length).toBe(1);
    expect(kit.brand?.name).toBe('Caffè Nero');
    expect(kit).not.toHaveProperty('history');
    expect(kit).not.toHaveProperty('rubric');
    expect(kit).not.toHaveProperty('operator_edits');
    expect(kit).not.toHaveProperty('week');
    expect(JSON.stringify(kit)).not.toContain('null');
  });

  it('il contratto e il catalogo dei formati non possono divergere', () => {
    expect([...KIT_FORMATS]).toEqual([...CONTENT_FORMATS]);
  });
});
