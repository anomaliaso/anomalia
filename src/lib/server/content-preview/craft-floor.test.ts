import { describe, it, expect, vi, beforeEach } from 'vitest';

const digest = { section: '' };

vi.mock('$lib/server/wall-digest', () => ({
  designWallDigestSection: () => Promise.resolve(digest.section)
}));

// Il percorso vero: kie. Prima si fingeva `{ endpoint: 'google' }` — un endpoint che il registro
// non sa produrre — e si leggevano i prompt dal ramo Google, che nessuna richiesta poteva
// raggiungere. Il pavimento del design si verificava su codice morto.
const renderOnKie = vi.fn();

vi.mock('$lib/server/kie-jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/kie-jobs')>()),
  generateImageOnKie: renderOnKie
}));

vi.mock('$lib/server/model-routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/model-routing')>()),
  route: () => ({ family: 'nano-banana', endpoint: 'kie', provider: 'kie' })
}));

vi.mock('$lib/server/research', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/research')>()),
  structured: vi.fn(async () => ({ pass: true, score: 9, issues: [], fixHint: '', brandStyleMatch: true }))
}));

const { buildImageRequest, renderBrandImage, renderCarouselSlide } = await import('./images');

const RENDERED = { dataUrl: 'data:image/png;base64,AAAA' };

const DESIGN_FLOOR =
  '\n\nAMBIENT DESIGN FLOOR (distilled 2026-08-20 from the strongest current feed design):\none oversized headline, 3-5 words, 60% of canvas height\n';

const PROMPT = 'A jar of honey on a linen cloth';
const RENDER_OPTS = { visualStyle: 'warm editorial', aspectRatio: '1:1' as const };

const promptsSentToModel = () =>
  renderOnKie.mock.calls.map((c) => c[0].contents[0].parts[0].text as string);

const failingStorage = {
  storage: { from: () => ({ upload: async () => ({ error: { message: 'no bucket' } }) }) }
};

beforeEach(() => {
  digest.section = '';
  renderOnKie.mockReset();
  renderOnKie.mockResolvedValue(RENDERED);
});

describe('il pavimento di esecuzione del design arriva al percorso immagine', () => {
  it('renderBrandImage lo inietta quando il digest esiste', async () => {
    digest.section = DESIGN_FLOOR;

    await renderBrandImage(PROMPT, RENDER_OPTS);

    expect(promptsSentToModel()[0]).toContain('AMBIENT DESIGN FLOOR');
  });

  it('renderCarouselSlide lo inietta su ogni slide', async () => {
    digest.section = DESIGN_FLOOR;

    await renderCarouselSlide(
      failingStorage as never,
      'user-1',
      'slide two: the mechanic',
      1,
      3,
      RENDER_OPTS,
      undefined,
      {}
    );

    expect(promptsSentToModel()[0]).toContain('AMBIENT DESIGN FLOOR');
  });

  it('senza digest il prompt resta identico a prima', async () => {
    await renderBrandImage(PROMPT, RENDER_OPTS);

    expect(promptsSentToModel()[0]).toBe(buildImageRequest(PROMPT, RENDER_OPTS).contents[0].parts[0].text);
  });

  it('il pavimento non tocca il soggetto: entra come blocco a sé, prima dello stile del brand', async () => {
    digest.section = DESIGN_FLOOR;

    await renderBrandImage(PROMPT, RENDER_OPTS);

    const text = promptsSentToModel()[0];
    expect(text).toContain('AMBIENT DESIGN FLOOR');
    expect(text.indexOf('AMBIENT DESIGN FLOOR')).toBeLessThan(text.indexOf('BRAND VISUAL STYLE'));
    expect(text.slice(0, PROMPT.length)).toBe(PROMPT);
  });
});
