import { describe, it, expect, vi, beforeEach } from 'vitest';

const findBrandMediaByIds = vi.fn();
const getPosts = vi.fn();
const structured = vi.fn();
const llmStructured = vi.fn();

vi.mock('$lib/server/brand-media', () => ({
  findBrandMediaByIds: (...args: unknown[]) => findBrandMediaByIds(...args)
}));
vi.mock('$lib/server/cli-queries', () => ({ getPosts: (...args: unknown[]) => getPosts(...args) }));
vi.mock('$lib/server/research', () => ({ structured: (...args: unknown[]) => structured(...args) }));
vi.mock('$lib/server/llm', () => ({
  llmStructured: (...args: unknown[]) => llmStructured(...args),
  llmConfigured: () => false,
  llmImagesFromInline: () => []
}));

import { checkContent, CONTENT_CHECK_RULES_VERSION } from './content-check';
import { CONTENT_SCORER_VERSION, scoreContentQuality } from './content-quality';
import { deterministicPrepublishIssues } from './prepublish-check';

const TZ = 'Europe/Rome';

const GOOD_CAPTION = [
  'Spedivamo il venerdì e il 22% dei resi arrivava il lunedì.',
  '',
  'Abbiamo spostato il cut-off al giovedì alle 14 e i resi sono scesi a 9% in tre settimane.',
  'Il magazzino non ha cambiato niente: è cambiata solo l ora di chiusura degli ordini.',
  '',
  'Raccontaci come gestisci il tuo cut-off.'
].join('\n');

function check(spec: Record<string, unknown>) {
  return checkContent({
    supabase: {} as never,
    brandId: 'brand-1',
    timezone: TZ,
    spec: { platforms: ['linkedin'], caption: GOOD_CAPTION, ...spec } as never
  });
}

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

beforeEach(() => {
  vi.clearAllMocks();
  findBrandMediaByIds.mockResolvedValue([]);
  getPosts.mockResolvedValue([]);
});

describe('checkContent', () => {
  it('promuove una copy sana e non inventa un errore per riempire il report', async () => {
    const report = await check({});

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('non chiama nessun modello: il verdetto è calcolato, non giudicato', async () => {
    await check({ platforms: ['instagram', 'x'], caption: 'a'.repeat(500) });

    expect(structured).not.toHaveBeenCalled();
    expect(llmStructured).not.toHaveBeenCalled();
  });

  it('dà lo stesso verdetto due volte: nessun orologio, nessun caso', async () => {
    const first = await check({});
    const second = await check({});

    expect(second.scores).toEqual(first.scores);
    expect(second.errors).toEqual(first.errors);
  });

  it('dichiara le versioni delle regole che ha applicato', async () => {
    const report = await check({});

    expect(report.versions).toEqual({
      rules: CONTENT_CHECK_RULES_VERSION,
      scorer: CONTENT_SCORER_VERSION
    });
  });

  it.each([
    ['vuota', ''],
    ['segnaposto', 'lorem ipsum dolor sit amet'],
    ['solo hashtag', '#uno #due #tre']
  ])(
    'ferma una caption %s, come già la ferma il gate di pubblicazione',
    async (_label, caption) => {
      const report = await check({ caption });

      expect(deterministicPrepublishIssues({ id: '', brand_id: '', platform: 'linkedin', caption, media_url: null })).not.toEqual([]);
      expect(report.ok).toBe(false);
      expect(report.errors.map((e) => e.field)).toContain('caption');
    }
  );

  it('ferma un segnaposto [NEED:] invece di lasciarlo uscire come numero vero', async () => {
    const caption = 'Abbiamo tagliato i resi del [NEED: percentuale reale] in un mese.';
    const report = await check({ caption });

    expect(report.ok).toBe(false);
    expect(codes(report.errors)).toContain('caption_needs_proof');
  });

  it('una copy oltre il limite dice quale piattaforma e quale campo riparare', async () => {
    const report = await check({ platforms: ['linkedin', 'x'], caption: 'a'.repeat(3001) });

    const overLimit = report.errors.find((e) => e.code === 'over_limit');
    expect(overLimit?.field).toBe('caption');
    expect(overLimit?.detail).toContain('LinkedIn');
    expect(overLimit?.detail).toContain('3000');
  });

  it('legge ogni piattaforma sulla copy che pubblicherebbe davvero, non su quella principale', async () => {
    const report = await check({
      platforms: ['linkedin', 'x'],
      caption: 'a'.repeat(2000),
      platformCaptions: { x: 'un pensiero corto' }
    });

    expect(codes(report.errors)).not.toContain('over_limit');
  });

  it.each(['instagram', 'tiktok'])('dice che %s non regge il solo testo, e quale campo lo risolve', async (platform) => {
    const report = await check({ platforms: [platform] });

    const needMedia = report.errors.find((e) => e.code === 'need_media');
    expect(needMedia?.field).toBe('media_ids');
  });

  it('youtube senza video chiede un video, non una foto', async () => {
    findBrandMediaByIds.mockResolvedValue([{ id: 'asset-1', kind: 'image' }]);
    const report = await check({ platforms: ['youtube'], mediaIds: ['asset-1'] });

    expect(codes(report.errors)).toContain('need_video');
  });

  it('un video della libreria soddisfa youtube', async () => {
    findBrandMediaByIds.mockResolvedValue([{ id: 'asset-1', kind: 'video' }]);
    const report = await check({ platforms: ['youtube'], mediaIds: ['asset-1'] });

    expect(codes(report.errors)).not.toContain('need_video');
    expect(codes(report.errors)).not.toContain('need_media');
  });

  it('reddit senza titolo nomina il campo title', async () => {
    const report = await check({ platforms: ['reddit'] });

    expect(report.errors.find((e) => e.code === 'reddit_title')?.field).toBe('title');
  });

  it('un media che non è di questo brand è un errore, non un post muto', async () => {
    findBrandMediaByIds.mockResolvedValue([]);
    const report = await check({ platforms: ['instagram'], mediaIds: ['asset-di-un-altro'] });

    const missing = report.errors.find((e) => e.code === 'media_not_found');
    expect(missing?.field).toBe('media_ids');
    expect(missing?.detail).toContain('asset-di-un-altro');
  });

  it('una piattaforma che il dominio non conosce non passa in silenzio', async () => {
    const report = await check({ platforms: ['myspace'] });

    expect(report.errors.find((e) => e.code === 'no_platforms')?.field).toBe('platforms');
  });

  it('una data illeggibile nomina scheduled_for', async () => {
    const report = await check({ scheduledFor: 'domani alle 18' });

    expect(report.errors.find((e) => e.code === 'invalid_scheduled_for')?.field).toBe('scheduled_for');
  });

  it('una data già passata è ferma qui, non alla creazione', async () => {
    const report = await check({ scheduledFor: '2020-01-01T09:00' });

    expect(codes(report.errors)).toContain('too_soon');
  });

  it('uno slot già occupato è un avviso, non un blocco: il calendario lo permette', async () => {
    getPosts.mockResolvedValue([
      { id: 'post-esistente', status: 'scheduled', scheduled_for: '2030-05-16T07:00:00.000Z', slot: null, platform: 'x', caption: 'già in calendario' }
    ]);
    const report = await check({ scheduledFor: '2030-05-16T09:00' });

    expect(report.ok).toBe(true);
    const clash = report.warnings.find((w) => w.code === 'calendar_conflict');
    expect(clash?.field).toBe('scheduled_for');
    expect(clash?.detail).toContain('post-esistente');
  });

  it('gli hashtag da reach sono un avviso sulla caption', async () => {
    const report = await check({ caption: `${GOOD_CAPTION}\n#fyp #viral` });

    expect(report.ok).toBe(true);
    expect(report.warnings.find((w) => w.code === 'reach_chasing_hashtags')?.field).toBe('caption');
  });

  it('dà lo stesso indice dello scorer interno, non un punteggio suo', async () => {
    const report = await check({ platforms: ['linkedin'] });

    expect(report.scores[0]).toMatchObject({
      platform: 'linkedin',
      index: scoreContentQuality({ caption: GOOD_CAPTION, platform: 'linkedin' }).index
    });
  });

  it('confronta con i post recenti del brand: la ripetizione esiste solo tra vicini', async () => {
    getPosts.mockResolvedValue([
      { id: 'p1', status: 'published', scheduled_for: null, slot: null, platform: 'linkedin', caption: GOOD_CAPTION }
    ]);
    const report = await check({ platforms: ['linkedin'] });

    const repetition = report.scores[0].checks.find((c) => c.id === 'self_repetition');
    expect(repetition?.value).toBeLessThan(1);
  });

  it('punteggia ogni piattaforma richiesta, perché la stessa copy non vale uguale ovunque', async () => {
    findBrandMediaByIds.mockResolvedValue([{ id: 'asset-1', kind: 'image' }]);
    const report = await check({ platforms: ['linkedin', 'instagram'], mediaIds: ['asset-1'] });

    expect(report.scores.map((s) => s.platform)).toEqual(['linkedin', 'instagram']);
  });
});
