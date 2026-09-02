import { describe, it, expect, vi, beforeEach } from 'vitest';

const digest = { section: '' };

vi.mock('$lib/server/wall-digest', () => ({
  designWallDigestSection: () => Promise.resolve(digest.section)
}));

const generateContent = vi.fn();

vi.mock('$lib/server/gemini', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/gemini')>()),
  googleGenaiClient: () => ({ models: { generateContent } })
}));

vi.mock('$lib/server/model-routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/model-routing')>()),
  route: () => ({ endpoint: 'google' })
}));

vi.mock('$lib/server/research', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/research')>()),
  structured: vi.fn(async () => ({ pass: true, score: 9, issues: [], fixHint: '', brandStyleMatch: true }))
}));

const { buildImageRequest, renderWithQC, renderCarouselSlide } = await import('./images');

const RENDERED = {
  candidates: [{ content: { parts: [{ inlineData: { data: 'AAAA', mimeType: 'image/png' } }] } }]
};

const DESIGN_FLOOR =
  '\n\nAMBIENT DESIGN FLOOR (distilled 2026-08-20 from the strongest current feed design):\none oversized headline, 3-5 words, 60% of canvas height\n';

const PROMPT = 'A jar of honey on a linen cloth';
const RENDER_OPTS = { visualStyle: 'warm editorial', aspectRatio: '1:1' as const };

const promptsSentToModel = () =>
  generateContent.mock.calls.map((c) => c[0].contents[0].parts[0].text as string);

const failingStorage = {
  storage: { from: () => ({ upload: async () => ({ error: { message: 'no bucket' } }) }) }
};

beforeEach(() => {
  digest.section = '';
  generateContent.mockReset();
  generateContent.mockResolvedValue(RENDERED);
});

describe('il pavimento di esecuzione del design arriva al percorso immagine', () => {
  it('renderWithQC lo inietta quando il digest esiste', async () => {
    digest.section = DESIGN_FLOOR;

    await renderWithQC(null as never, PROMPT, RENDER_OPTS, {}, false);

    expect(promptsSentToModel()[0]).toContain('AMBIENT DESIGN FLOOR');
  });

  it('renderCarouselSlide lo inietta su ogni slide', async () => {
    digest.section = DESIGN_FLOOR;

    await renderCarouselSlide(
      null as never,
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
    await renderWithQC(null as never, PROMPT, RENDER_OPTS, {}, false);

    expect(promptsSentToModel()[0]).toBe(buildImageRequest(PROMPT, RENDER_OPTS).contents[0].parts[0].text);
  });

  it('il pavimento non tocca il soggetto: entra come blocco a sé, prima dello stile del brand', async () => {
    digest.section = DESIGN_FLOOR;

    await renderWithQC(null as never, PROMPT, RENDER_OPTS, {}, false);

    const text = promptsSentToModel()[0];
    expect(text).toContain('AMBIENT DESIGN FLOOR');
    expect(text.indexOf('AMBIENT DESIGN FLOOR')).toBeLessThan(text.indexOf('BRAND VISUAL STYLE'));
    expect(text.slice(0, PROMPT.length)).toBe(PROMPT);
  });
});
