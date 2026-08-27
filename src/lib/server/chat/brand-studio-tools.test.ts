import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { noteRead, resetReadReceipts } from './read-guards';

/**
 * I tool che scrivono il Brand Studio. Le proprietà provate qui sono quelle che, rotte, NON
 * falliscono da nessuna parte — si limitano a produrre asset sbagliati per sempre:
 *
 *  - il logo è UNO slot che si sostituisce (accodare lo rendeva invisibile al renderer);
 *  - il logo finisce nel bucket del brand, non come URL remoto che scade;
 *  - ogni scrittura d'identità restituisce il valore di PRIMA, che è ciò che la rende reversibile;
 *  - un font che Google Fonts non serve viene rifiutato, non renderizzato in silenzio come Inter;
 *  - una piattaforma sconosciuta non entra in `target_platforms`;
 *  - il consenso di una persona reale si scrive solo con chi l'ha attestato e quando.
 */

type Row = Record<string, unknown>;
type Op = { table: string; kind: string; payload?: Row; filters: [string, unknown][] };

let ops: Op[] = [];
let singles: Record<string, Row | null> = {};
let counts: Record<string, number> = {};
// Righe restituite quando il builder viene awaitato direttamente (select multi-riga).
let lists: Record<string, Row[] | null> = {};
let storageOps: { bucket: string; kind: string; arg?: unknown }[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeClient(): any {
  const from = (table: string) => {
    const op: Op = { table, kind: '', filters: [] };
    let counted = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      select(_cols?: unknown, opt?: { count?: string; head?: boolean }) {
        if (!op.kind) op.kind = 'select';
        if (opt?.count) counted = true;
        return self;
      },
      insert(payload: Row) {
        op.kind = 'insert';
        op.payload = payload;
        ops.push(op);
        return self;
      },
      update(payload: Row) {
        op.kind = 'update';
        op.payload = payload;
        ops.push(op);
        return self;
      },
      upsert(payload: Row) {
        op.kind = 'upsert';
        op.payload = payload;
        ops.push(op);
        return self;
      },
      delete() {
        op.kind = 'delete';
        ops.push(op);
        return self;
      },
      eq(col: string, val: unknown) {
        op.filters.push([col, val]);
        return self;
      },
      in: () => self,
      is: () => self,
      order: () => self,
      limit: () => self,
      neq: () => self,
      not: () => self,
      async maybeSingle() {
        if (op.kind === 'select' && !ops.includes(op)) ops.push(op);
        const data = op.kind === 'insert' ? { id: `${table}-new` } : (singles[table] ?? null);
        return { data, error: null };
      },
      async single() {
        if (op.kind === 'select' && !ops.includes(op)) ops.push(op);
        const data = op.kind === 'insert' ? { id: `${table}-new` } : (singles[table] ?? null);
        return { data, error: null };
      },
      // Awaiting the builder directly (update/delete/count) has to resolve like PostgREST does.
      then(resolve: (v: unknown) => unknown) {
        if (op.kind === 'select' && !ops.includes(op)) ops.push(op);
        return Promise.resolve(
          counted
            ? { count: counts[table] ?? 0, data: [], error: null }
            : { data: lists[table] ?? null, error: null }
        ).then(resolve);
      }
    };
    return self;
  };

  return {
    from,
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          storageOps.push({ bucket, kind: 'upload', arg: path });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          storageOps.push({ bucket, kind: 'remove', arg: paths });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } })
      })
    }
  };
}

// Il fetch del logo: sostituito qui, così non serve rete e si può provare cosa viene SALVATO.
vi.mock('$lib/server/brand-analysis', () => ({
  isUrlSafe: (u: string) => !u.includes('localhost'),
  extractColorsFromImage: async () => ['#112233', 'not-a-color']
}));

const fontAvailable = vi.fn(async (family: string) => family !== 'Fake Sans');
vi.mock('$lib/server/design-typography', () => ({
  fontIsAvailable: (f: string) => fontAvailable(f)
}));

vi.mock('$lib/server/onboarding', () => ({
  approveStudioIfNeeded: async () => ({ approved: false, already: true, state: { phase: 'done' } })
}));

vi.mock('$lib/server/knowledge', () => ({
  COLLECTIONS: ['brand', 'product', 'commercial', 'legal', 'operations', 'research'],
  saveDocumentMarkdown: async () => {},
  kickKnowledgeWork: async () => {},
  ingestDocument: async () => ({ id: 'doc-1', deduped: false })
}));

vi.mock('$lib/server/media-archive', () => ({
  archiveImageToBucket: async (_c: unknown, path: string) => path,
  signKnowledgePaths: async () => new Map()
}));

// I tool di publish-safety (approve/reject/reschedule/cross_post) e la loro classe di incidente
// (scheduling 07/2026): Zernio e il renderer sono sostituiti, il resto del modulo resta vero.
const pub = vi.hoisted(() => ({
  publishApprovedPost: vi.fn(async () => ({ scheduled: 1, failed: 0, noAccount: false })),
  requireZernioCancellation: vi.fn(async () => ({ undeleted: [] })),
  regeneratePost: vi.fn(async () => ({
    imageUrl: 'https://cdn.test/new-cover.png',
    imagePrompt: 'nuovo prompt',
    caption: 'nuova caption'
  })),
  createSingleContent: vi.fn(async () => ({ caption: 'c', imageUrls: ['a', 'b'] })),
  budget: {
    posts: 10,
    postsUsed: 0,
    postsQuota: 30,
    credits: { remaining: 100, quota: 100, used: 0, periodEnd: new Date('2026-09-01T00:00:00Z') }
  }
}));

vi.mock('$lib/server/publish', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  publishApprovedPost: pub.publishApprovedPost
}));
vi.mock('$lib/server/post-editing', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireZernioCancellation: pub.requireZernioCancellation
}));
vi.mock('$lib/server/usage', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  remaining: async () => pub.budget
}));
vi.mock('$lib/server/content-preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  regeneratePost: pub.regeneratePost,
  createSingleContent: pub.createSingleContent,
  loadBrandMoodImageUrls: async () => []
}));

// Il grafo di import di tools.ts è grosso: si carica UNA volta, o la prima `it` spende il suo
// timeout a compilare invece che a provare qualcosa.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createChatTools: any;
beforeAll(async () => {
  ({ createChatTools } = await import('./tools'));
}, 60_000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tools(): any {
  return createChatTools(fakeClient(), 'brand-1', 'Europe/Rome', 'user-1');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (t: any, input: Row) => t.execute(input, { toolCallId: 't', messages: [] });

const opFor = (table: string, kind: string) => ops.find((o) => o.table === table && o.kind === kind);

beforeEach(() => {
  ops = [];
  singles = {};
  counts = {};
  lists = {};
  storageOps = [];
  resetReadReceipts();
  pub.publishApprovedPost.mockClear();
  pub.requireZernioCancellation.mockClear();
  pub.regeneratePost.mockClear();
  pub.createSingleContent.mockClear();
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'image/png' },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
  }));
});

describe('update_brand_colors', () => {
  it('applica lo stesso filtro del form e restituisce la palette di prima', async () => {
    singles.brand_kit = { brand_colors: ['#000000'] };
    const t = tools();
    const res = await run(t.update_brand_colors, { colors: ['#FF5733', 'chartreuse', '#00FF00'] });

    expect(res).toMatchObject({ success: true, colors: ['#FF5733', '#00FF00'], previous_colors: ['#000000'] });
    // Upsert (con brand_id), non update: su un brand senza riga brand_kit l'update colpiva zero
    // righe e "riusciva" — vedi finding #6 dell'audit.
    expect(opFor('brand_kit', 'upsert')?.payload).toEqual({ brand_id: 'brand-1', brand_colors: ['#FF5733', '#00FF00'] });
  });

  it('non scrive niente se non resta nemmeno un colore valido', async () => {
    const t = tools();
    const res = await run(t.update_brand_colors, { colors: ['red', 'blue'] });
    expect(res.error).toMatch(/No valid hex colors/);
    expect(opFor('brand_kit', 'upsert')).toBeUndefined();
  });
});

describe('update_logo', () => {
  it('SOSTITUISCE lo slot invece di accodare, e salva nel bucket del brand', async () => {
    singles.brand_kit = { logos: [{ url: 'https://old.test/logo.png', type: 'uploaded' }], favicon_url: null };
    const t = tools();
    const res = await run(t.update_logo, { image_url: 'https://cdn.example/new.png' });

    expect(res.success).toBe(true);
    // Un solo logo, e non è l'URL remoto passato: è la copia nel bucket `media`.
    const logos = opFor('brand_kit', 'upsert')?.payload?.logos as Row[];
    expect(logos).toHaveLength(1);
    expect(String(logos[0].url)).toContain('https://cdn.test/user-1/studio/logo-');
    expect(storageOps[0]).toMatchObject({ bucket: 'media', kind: 'upload' });
    // La scia che rende reversibile la scrittura.
    expect(res.previous_url).toBe('https://old.test/logo.png');
  });

  it('rifiuta un URL che la guardia SSRF non accetta, senza toccare il brand', async () => {
    const t = tools();
    const res = await run(t.update_logo, { image_url: 'http://localhost/logo.png' });
    expect(res.error).toMatch(/not fetchable/);
    expect(opFor('brand_kit', 'upsert')).toBeUndefined();
  });

  it('remove svuota lo slot e dice cosa c’era', async () => {
    singles.brand_kit = { logos: [{ url: 'https://old.test/logo.png' }], favicon_url: null };
    const t = tools();
    const res = await run(t.update_logo, { remove: true });
    expect(res).toMatchObject({ removed: true, previous_url: 'https://old.test/logo.png' });
    expect(opFor('brand_kit', 'upsert')?.payload).toEqual({ brand_id: 'brand-1', logos: [] });
  });
});

describe('update_brand_kit', () => {
  it('rifiuta un font che Google Fonts non serve, invece di renderizzare Inter in silenzio', async () => {
    const t = tools();
    const res = await run(t.update_brand_kit, {
      graphic_style: { display_font: 'Fake Sans', body_font: 'Inter' }
    });
    expect(res.error).toMatch(/Fake Sans/);
    expect(opFor('brand_kit', 'upsert')).toBeUndefined();
  });

  it('rifiuta un brief visivo troppo corto, come il form', async () => {
    const t = tools();
    expect((await run(t.update_brand_kit, { visual_style: 'poco' })).error).toMatch(/too short/);
  });

  it('bloccando il brief visivo appena scritto, o il rebuild notturno lo cancella', async () => {
    const t = tools();
    const res = await run(t.update_brand_kit, { visual_style: 'x'.repeat(50) });
    expect(res.success).toBe(true);
    expect(opFor('brand_kit', 'upsert')?.payload).toMatchObject({ visual_style_locked: true });
  });

  it('scrive il sito in tutti e due i posti che i lettori usano', async () => {
    const t = tools();
    await run(t.update_brand_kit, { website: 'anomalia.so' });
    expect(opFor('brand_kit', 'upsert')?.payload).toMatchObject({ source_url: 'https://anomalia.so' });
    expect(opFor('brands', 'update')?.payload).toMatchObject({ website: 'https://anomalia.so' });
  });

  it('tiene solo le piattaforme note e traduce twitter in x', async () => {
    const t = tools();
    const res = await run(t.update_brand_kit, { target_platforms: ['twitter', 'instagram', 'myspace'] });
    expect(res.success).toBe(true);
    expect(opFor('brands', 'update')?.payload?.target_platforms).toEqual(['x', 'instagram']);
  });

  it('se NESSUNA piattaforma è nota lo dice, invece di azzerare la lista', async () => {
    const t = tools();
    const res = await run(t.update_brand_kit, { target_platforms: ['myspace'] });
    expect(res.error).toMatch(/Unknown platforms/);
    expect(opFor('brands', 'update')).toBeUndefined();
  });
});

describe('update_voice', () => {
  it('normalizza gli hashtag e scrive content_prefs UNA volta sola', async () => {
    singles.brands = { content_prefs: { language: 'Italian' } };
    const t = tools();
    const res = await run(t.update_voice, {
      platform_hashtags: { instagram: '#brand estate!, #brand' },
      voice_examples: ['  primo post ', '', 'secondo']
    });

    expect(res.success).toBe(true);
    const writes = ops.filter((o) => o.table === 'brands' && o.kind === 'update');
    expect(writes).toHaveLength(1);
    expect(writes[0].payload?.content_prefs).toEqual({
      language: 'Italian',
      platformHashtags: { instagram: ['#brand', '#estate'] },
      voiceExamples: ['primo post', 'secondo']
    });
  });
});

describe('update_person', () => {
  it('il consenso porta con sé chi l’ha attestato e quando — mai un true da solo', async () => {
    const t = tools();
    const res = await run(t.update_person, { person_id: 'p1', consent: true });
    expect(res.success).toBe(true);
    expect(opFor('people', 'update')?.payload).toMatchObject({
      consent: true,
      consent_source: 'owner_attested'
    });
    expect(opFor('people', 'update')?.payload?.consent_at).toBeTruthy();
  });

  it('cancellare una persona toglie prima le sue foto dal bucket', async () => {
    singles.people = { images: [{ path: 'u/b/face.jpg' }] };
    const t = tools();
    const res = await run(t.update_person, { person_id: 'p1', remove: true });
    expect(res.removed).toBe(true);
    expect(storageOps).toContainEqual({ bucket: 'brand-knowledge', kind: 'remove', arg: ['u/b/face.jpg'] });
    expect(opFor('people', 'delete')).toBeTruthy();
  });
});

describe('update_competitor', () => {
  it('senza id aggiunge, marcato come scelta dell’utente', async () => {
    const t = tools();
    const res = await run(t.update_competitor, { name: 'Rivale', website: 'rivale.com', kind: 'indirect' });
    expect(res).toMatchObject({ added: true, competitor_id: 'competitors-new' });
    expect(opFor('competitors', 'insert')?.payload).toMatchObject({
      name: 'Rivale',
      website: 'https://rivale.com',
      kind: 'indirect',
      source: 'user'
    });
  });

  it('con id modifica, e un nome vuoto è un rifiuto come nel form', async () => {
    const t = tools();
    expect((await run(t.update_competitor, { competitor_id: 'c1', name: '  ' })).error).toMatch(/name cannot be empty/);
    expect(opFor('competitors', 'update')).toBeUndefined();
  });

  it('remove senza id non cancella a caso', async () => {
    const t = tools();
    expect((await run(t.update_competitor, { remove: true })).error).toMatch(/competitor_id is required/);
    expect(opFor('competitors', 'delete')).toBeUndefined();
  });
});

describe('update_document', () => {
  it('non tocca un riferimento di stile scambiandolo per un documento', async () => {
    singles.brand_documents = { id: 'd1', kind: 'image', file_url: 'u/b/mood.jpg' };
    const t = tools();
    const res = await run(t.update_document, { document_id: 'd1', remove: true });
    expect(res.error).toMatch(/mood reference/);
    expect(opFor('brand_documents', 'delete')).toBeUndefined();
  });

  it('rifiuta la modifica di un documento mai letto', async () => {
    singles.brand_documents = { id: 'd1', kind: 'note', file_url: null, updated_at: 't1' };
    const t = tools();
    const res = await run(t.update_document, { document_id: 'd1', title: 'Nuovo' });
    expect(res.error).toMatch(/Read before writing/);
    expect(opFor('brand_documents', 'update')).toBeUndefined();
  });

  it('rifiuta la modifica se il documento è cambiato dopo la lettura', async () => {
    singles.brand_documents = { id: 'd1', kind: 'note', file_url: null, updated_at: 't2' };
    noteRead('document', 'd1', 't1');
    const t = tools();
    const res = await run(t.update_document, { document_id: 'd1', title: 'Nuovo' });
    expect(res.error).toMatch(/changed since your last read/);
    expect(opFor('brand_documents', 'update')).toBeUndefined();
  });

  it('dopo una lettura fresca scrive e il timbro nuovo diventa il receipt', async () => {
    singles.brand_documents = { id: 'd1', kind: 'note', file_url: null, updated_at: 't1' };
    noteRead('document', 'd1', 't1');
    const t = tools();
    const res = await run(t.update_document, { document_id: 'd1', title: 'Nuovo' });
    expect(res.success).toBe(true);
    const op = opFor('brand_documents', 'update');
    expect((op?.payload as Row).title).toBe('Nuovo');
    expect((op?.payload as Row).updated_at).toBeTruthy();

    // Il receipt è ora il timbro appena scritto: la modifica successiva passa senza rileggere.
    singles.brand_documents = { id: 'd1', kind: 'note', file_url: null, updated_at: (op?.payload as Row).updated_at };
    const second = await run(tools().update_document, { document_id: 'd1', title: 'Ancora' });
    expect(second.success).toBe(true);
  });
});

describe('update_mood_references', () => {
  it('rispetta il tetto di 3 che la UI dichiara e il renderer applica', async () => {
    counts.brand_documents = 3;
    const t = tools();
    const res = await run(t.update_mood_references, { image_url: 'https://cdn.example/a.jpg' });
    expect(res.error).toMatch(/Max 3 reference images/);
    expect(opFor('brand_documents', 'insert')).toBeUndefined();
  });

  it('archivia l’immagine invece di salvarne il link che scade', async () => {
    counts.brand_documents = 0;
    const t = tools();
    const res = await run(t.update_mood_references, { image_url: 'https://cdn.example/a.jpg' });
    expect(res.success).toBe(true);
    const row = opFor('brand_documents', 'insert')?.payload as Row;
    expect(String(row.file_url)).toContain('user-1/brand-1/mood/');
    expect(String(row.file_url)).not.toContain('cdn.example');
  });
});

/**
 * Audit dei tool condivisi (2026-08) — la classe di difetti dell'incidente scheduling 07/2026.
 * Un test per finding: ognuno fallisce se il fix regredisce.
 */
describe('publish-safety (audit findings 1-3)', () => {
  it('#1 reschedule_post rifiuta un draft pending_user invece di pubblicarlo', async () => {
    singles.posts = { id: 'post-1', status: 'pending_user' };
    const t = tools();
    const res = await run(t.reschedule_post, { post_id: 'post-1', scheduled_for: '2030-01-05T10:00' });

    expect(res.error).toMatch(/approve_post/);
    expect(pub.requireZernioCancellation).not.toHaveBeenCalled();
    expect(pub.publishApprovedPost).not.toHaveBeenCalled();
    expect(opFor('posts', 'update')).toBeUndefined();
  });

  it('#1 list_calendar_conflicts separa i draft pending e non insegna il bypass', async () => {
    lists.posts = [
      { id: 'a', status: 'pending_user', scheduled_for: '2030-01-05T10:00:00Z', slot: null, platform: 'instagram', caption: 'draft' },
      { id: 'b', status: 'scheduled', scheduled_for: '2030-01-05T10:00:00Z', slot: null, platform: 'linkedin', caption: 'live' }
    ];
    const t = tools();
    const res = await run(t.list_calendar_conflicts, {});

    expect(res.conflict_count).toBe(1);
    const posts = res.conflicts[0].posts as Row[];
    expect(posts.find((p) => p.id === 'a')).toMatchObject({ pending_approval: true });
    expect(posts.find((p) => p.id === 'b')?.pending_approval).toBeUndefined();
    expect(res.hint).toMatch(/needs approval first/);
    expect(res.hint).toMatch(/never reschedule_post them/);
  });

  it('#2 reject_post revoca Zernio PRIMA di cancellare uno scheduled, e rifiuta un published', async () => {
    singles.posts = { id: 'post-1', status: 'scheduled' };
    const t = tools();
    const res = await run(t.reject_post, { post_id: 'post-1', confirm: true });
    expect(res.success).toBe(true);
    expect(pub.requireZernioCancellation).toHaveBeenCalledTimes(1);
    expect(opFor('posts', 'delete')).toBeTruthy();

    ops = [];
    pub.requireZernioCancellation.mockClear();
    singles.posts = { id: 'post-2', status: 'published' };
    const refused = await run(t.reject_post, { post_id: 'post-2', confirm: true });
    expect(refused.error).toMatch(/un-publish/);
    expect(opFor('posts', 'delete')).toBeUndefined();
  });

  it('#3 approve_post non tocca scheduled_for di un post che non è pending_user', async () => {
    singles.posts = { id: 'post-1', status: 'scheduled' };
    const t = tools();
    const res = await run(t.approve_post, { post_id: 'post-1', scheduled_for: '2030-01-05T10:00' });

    expect(res.error).toMatch(/already scheduled/);
    // Prima del fix l'orario veniva scritto PRIMA del guard: l'approve rifiutato aveva già
    // spostato la schedulazione del post.
    expect(opFor('posts', 'update')).toBeUndefined();
    expect(pub.publishApprovedPost).not.toHaveBeenCalled();
  });
});

describe('success-shaped failures (audit findings 4-8)', () => {
  it('#4 cross_post clona TUTTO il set media/contenuto e un publish fallito non è un successo', async () => {
    singles.posts = {
      id: 'post-1', status: 'published', platform: 'instagram', platforms: null,
      caption: 'cap', platform_captions: { x: 'short' }, title: 'Titolo', link_url: 'https://l.example',
      subreddit: null, first_comment: '#tag', image_prompt: 'ip', image_prompts: ['ip1', 'ip2'],
      media_url: 'https://m/1.png', media_urls: ['https://m/1.png', 'https://m/2.png', 'https://m/3.png'],
      video_thumbnail_url: null, youtube_thumbnail_url: null, product_name: 'Prodotto',
      content_type: 'generated_image', format: 'carousel'
    };
    pub.publishApprovedPost.mockRejectedValueOnce(new Error('zernio down'));
    const t = tools();
    const res = await run(t.cross_post, { post_id: 'post-1', platforms: ['facebook'] });

    // Il clone porta le slide, i tagli per piattaforma e il resto del contenuto.
    expect(opFor('posts', 'insert')?.payload).toMatchObject({
      media_urls: ['https://m/1.png', 'https://m/2.png', 'https://m/3.png'],
      platform_captions: { x: 'short' },
      title: 'Titolo',
      link_url: 'https://l.example',
      first_comment: '#tag',
      image_prompts: ['ip1', 'ip2'],
      product_name: 'Prodotto',
      format: 'carousel'
    });
    // E il fallimento è netto: niente success:true + publish_error.
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/FAILED/);
    expect(res.clone_post_id).toBe('posts-new');
  });

  it('#5 update_voice senza piano attivo dice che i campi voce NON sono stati salvati', async () => {
    const t = tools();
    const res = await run(t.update_voice, { mood: 'giocoso', tone: 'amichevole' });

    expect(res.success).toBeUndefined();
    expect(res.error).toMatch(/No active editorial plan/);
    expect(res.error).toMatch(/mood, tone/);
    expect(ops.filter((o) => o.table === 'editorial_plans' && o.kind === 'update')).toHaveLength(0);
  });

  it('#6 il trio brand-kit scrive in upsert: zero righe non è più un successo silenzioso', async () => {
    const t = tools();
    const res = await run(t.extract_colors, { image_url: 'https://cdn.example/logo.png' });

    expect(res.success).toBe(true);
    // extractColorsFromImage (mock) torna anche 'not-a-color': passa solo l'hex valido, e la
    // scrittura è un upsert con brand_id — come update_brand_kit, per il brand senza riga.
    expect(opFor('brand_kit', 'upsert')?.payload).toEqual({ brand_id: 'brand-1', brand_colors: ['#112233'] });
    expect(opFor('brand_kit', 'update')).toBeUndefined();
  });

  it('#7 generate_image su un carosello sostituisce la cover anche in media_urls', async () => {
    singles.posts = {
      id: 'post-1', brand_id: 'brand-1', platform: 'instagram', caption: 'c', image_prompt: 'ip',
      media_url: 'https://m/old1.png', media_urls: ['https://m/old1.png', 'https://m/old2.png', 'https://m/old3.png'],
      content_type: 'generated_image', format: 'carousel', product_name: null, status: 'pending_user'
    };
    const t = tools();
    const res = await run(t.generate_image, { prompt: 'nuova cover', post_id: 'post-1' });

    expect(res.success).toBe(true);
    expect(pub.regeneratePost).toHaveBeenCalledTimes(1);
    // Senza questa riga la cover nuova esisteva solo in chat: il publish legge media_urls.
    expect(opFor('posts', 'update')?.payload).toMatchObject({
      media_url: 'https://cdn.test/new-cover.png',
      media_urls: ['https://cdn.test/new-cover.png', 'https://m/old2.png', 'https://m/old3.png']
    });
  });

  it('#8 read_posts allega le immagini come image-data (input_image anche su OpenAI-compat)', async () => {
    const t = tools();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (t.read_posts as any).toModelOutput({
      output: { posts: [{ id: 'p1', media_url: 'https://cdn.example/a.png' }] }
    });

    expect(out.type).toBe('content');
    const image = out.value.find((v: Row) => v.type !== 'text');
    // 'file-data' diventava input_file (documento) sul provider OpenAI-compat: il modello
    // "recensiva" immagini mai viste. 'image-data' è input_image su entrambi i provider.
    expect(image).toMatchObject({ type: 'image-data', mediaType: 'image/png' });
    expect(String(image.data).length).toBeGreaterThan(0);
  });
});

describe('scritture silenziose minori (audit findings 9-12)', () => {
  it('#9 update_editorial_plan: week_index fuori range è un errore col range valido', async () => {
    singles.editorial_plans = { id: 'plan-1', voice: {}, cadence: '3/week', platform_mix: [], weeks: [{}, {}, {}, {}] };
    const t = tools();
    const res = await run(t.update_editorial_plan, { week_index: 7, week_theme: 'Estate' });

    expect(res.error).toMatch(/out of range/);
    expect(res.error).toMatch(/0-3/);
    expect(opFor('editorial_plans', 'update')).toBeUndefined();
  });

  it('#10 update_person fonde attributes con l’esistente invece di sostituirli', async () => {
    singles.people = { attributes: { gender: 'female', ageRange: '30s' } };
    const t = tools();
    const res = await run(t.update_person, { person_id: 'p1', attributes: { expertise: 'ski' } });

    expect(res.success).toBe(true);
    expect(opFor('people', 'update')?.payload?.attributes).toEqual({
      gender: 'female',
      ageRange: '30s',
      expertise: 'ski'
    });
  });

  it('#11 update_post.content_type insegna i valori che il sistema usa davvero', async () => {
    const t = tools();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const desc = String((t.update_post as any).inputSchema.shape.content_type.description);
    expect(desc).toMatch(/generated_image/);
    expect(desc).toMatch(/generated_video/);
    // 'carousel'/'reel'/'story' compaiono solo come valori da NON usare.
    expect(desc).toMatch(/NOT "carousel"/);
  });

  it('#12 create_post: carosello + use_as_is passa dal gate crediti (use_as_is viene coartato)', async () => {
    singles.brands = { name: 'B', plan: 'pro', timezone: 'Europe/Rome', content_prefs: {}, target_platforms: ['instagram'] };
    pub.budget.credits.remaining = 0;
    try {
      const t = tools();
      const res = await run(t.create_post, {
        brief: 'tre consigli',
        platform: 'instagram',
        content_type: 'carousel',
        media_ids: ['m1'],
        media_mode: 'use_as_is'
      });
      expect(res.error).toBe('credits_exhausted');
      expect(pub.createSingleContent).not.toHaveBeenCalled();
    } finally {
      pub.budget.credits.remaining = 100;
    }
  });
});

describe('perimetro dei sotto-agenti', () => {
  /**
   * La decisione sul raggio d'azione: l'identità del brand non si cambia da un worker delegato.
   * Non è una scheda di conferma davanti a chi l'ha chiesto — è il caso opposto, la scrittura che
   * NESSUNO ha chiesto, decisa tre livelli sotto con un brief parziale e senza nessuno che guardi.
   */
  it('un worker può modificare un post, ma non il logo né la palette', async () => {
    const { subagentToolNames } = await import('./subagents');
    const available = [
      'update_logo',
      'update_brand_colors',
      'extract_colors',
      'update_post',
      'read_brand_kit'
    ];
    const names = subagentToolNames('execute', null, available);

    expect(names).not.toContain('update_logo');
    expect(names).not.toContain('update_brand_colors');
    expect(names).not.toContain('extract_colors');
    // Le altre scritture restano: il punto non è bloccare i sotto-agenti, è bloccare QUESTE tre.
    expect(names).toContain('update_post');
    expect(names).toContain('read_brand_kit');
  });
});
