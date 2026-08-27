import { describe, expect, it } from 'vitest';
import {
  buildRemixPool,
  buildRemixPrompt,
  buildRemixProduceParams,
  composeRemixVisualPrompt,
  digestToNormalizedAd,
  isThirdPartyAdMediaUrl,
  onlyOwnMediaUrls,
  remixBriefRow,
  REMIX_MAX_BRIEFS,
  type RemixBrief
} from './ads-remix';
import type { NormalizedAd } from './competitor-ads';

function ad(id: string, overrides: Partial<NormalizedAd> = {}): NormalizedAd {
  return {
    adArchiveId: id,
    pageName: 'Competitor A',
    pageId: null,
    body: 'body',
    cta: 'Shop Now',
    linkUrl: null,
    platforms: ['facebook'],
    displayFormat: 'single_image',
    thumbnailUrl: null,
    startDate: null,
    isActive: true,
    libraryUrl: `https://www.facebook.com/ads/library/?id=${id}`,
    ...overrides
  };
}

describe('ads remix helpers', () => {
  it('builds the pool from per-competitor snapshots then trending, deduped and capped', () => {
    const perCompetitor = new Map([
      ['A', [ad('a1'), ad('a2'), ad('a3')]],
      ['B', [ad('a2'), ad('b1')]] // a2 duplicate must appear once
    ]);
    const trending = [ad('a3'), ad('t1')]; // a3 duplicate
    const pool = buildRemixPool(perCompetitor, trending, 3);
    expect(pool.map((a) => a.adArchiveId)).toEqual(['a1', 'a2', 'a3']);
  });

  it('says the catalogue is empty rather than dropping the line entirely', () => {
    const prompt = buildRemixPrompt({ brandName: 'Acme', kit: {}, products: [], ads: [ad('a1')] });
    expect(prompt).toContain('OUR PRODUCTS & SERVICES: (no products in catalog)');
  });

  it('caps the pool and stops early', () => {
    const perCompetitor = new Map([['A', [ad('a1'), ad('a2'), ad('a3'), ad('a4'), ad('a5')]]]);
    const pool = buildRemixPool(perCompetitor, [], 2);
    expect(pool).toHaveLength(2);
  });

  it('keeps strategy structure in the prompt and honours the brief cap', () => {
    const prompt = buildRemixPrompt({
      brandName: 'Acme',
      kit: { about: 'SaaS for PMI', targetAudience: 'SMB owners in IT' },
      products: [{ title: 'CRM', description: 'Sales pipeline', url: 'https://acme.it/crm' }],
      ads: [ad('a1', { body: 'hook text', cta: 'Shop Now' })]
    });
    expect(prompt).toContain('BRAND: Acme');
    expect(prompt).toContain('CRM');
    // `title` is the column products actually has. The old fixture said `name`, which is why a
    // select for a non-existent column shipped: the test agreed with the bug.
    expect(prompt).toContain('page: https://acme.it/crm');
    expect(prompt).toContain('hook');
    expect(prompt).toContain(`id=a1`);
    expect(prompt).toContain('Max 5 briefs');
    expect(prompt).toContain('Max 5 briefs'.replace('5', String(REMIX_MAX_BRIEFS)));
  });

  it('maps Meta Ad Library digest rows into NormalizedAd for selected remix', () => {
    const n = digestToNormalizedAd({
      id: '999',
      pageName: 'Cal AI',
      body: 'Stop guessing macros',
      title: 'Calorie tracking',
      ctaText: 'Learn more',
      linkUrl: 'https://example.com',
      isActive: true,
      startDate: '2026-01-01',
      platforms: ['FACEBOOK', 'INSTAGRAM'],
      mediaType: 'video',
      imageUrl: 'https://cdn.example/a.jpg',
      videoUrl: null
    });
    expect(n.adArchiveId).toBe('999');
    expect(n.pageName).toBe('Cal AI');
    expect(n.body).toMatch(/macros/i);
    expect(n.cta).toMatch(/Learn more/i);
    expect(n.thumbnailUrl).toContain('cdn.example');
    expect(n.libraryUrl).toContain('id=999');
  });
});

describe('remixBriefRow (insert payload)', () => {
  const BRIEF: RemixBrief = {
    sourceAdId: 'a1',
    sourcePageName: 'Competitor A',
    sourceBody: 'body',
    sourceThumbnail: 'brand/knowledge/a1.jpg',
    sourceLibraryUrl: 'https://www.facebook.com/ads/library/?id=a1',
    rank: 1,
    strategy: 'strategy',
    keep: 'hook structure',
    change: 'product',
    hook: 'hook',
    headline: 'headline',
    body: null,
    cta: null,
    productName: 'CRM',
    visualPrompt: 'visual',
    status: 'proposed'
  };

  // ads_remix_briefs is snake_case (migration 0151) — a camelCase key makes PostgREST reject the
  // whole insert at runtime, which is invisible to the type checker.
  it('emits only snake_case column keys', () => {
    const row = remixBriefRow('brand-1', BRIEF);
    for (const key of Object.keys(row)) expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('maps every camelCase field onto its column', () => {
    expect(remixBriefRow('brand-1', BRIEF)).toEqual({
      brand_id: 'brand-1',
      source_ad_id: 'a1',
      source_page_name: 'Competitor A',
      source_body: 'body',
      source_thumbnail: 'brand/knowledge/a1.jpg',
      source_library_url: 'https://www.facebook.com/ads/library/?id=a1',
      rank: 1,
      strategy: 'strategy',
      keep: 'hook structure',
      change: 'product',
      hook: 'hook',
      headline: 'headline',
      body: null,
      cta: null,
      product_name: 'CRM',
      visual_prompt: 'visual',
      status: 'proposed'
    });
  });
});

// ------------------------------------------------------------------------------------------------
// DAL VIDEO DI UN TERZO ESCE SOLO TESTO.
// Questi test sono il lato eseguibile del vincolo: se un domani un URL fbcdn riuscisse ad arrivare
// nelle reference di una generazione, qui si spacca — non in produzione, a clip pagata (~$1.80).
// ------------------------------------------------------------------------------------------------

const COMPETITOR_MP4 = 'https://video.xx.fbcdn.net/v/t42.1790-2/hd.mp4';
const COMPETITOR_JPG = 'https://scontent.xx.fbcdn.net/v/t39/poster.jpg';
const OUR_MP4 = 'https://xyz.supabase.co/storage/v1/object/sign/media/u1/clip.mp4?token=x';
const OUR_JPG = 'https://xyz.supabase.co/storage/v1/object/sign/media/u1/product.jpg?token=x';

describe('third-party media gate', () => {
  it('recognises the CDNs a competitor creative lives on', () => {
    for (const u of [
      COMPETITOR_MP4,
      COMPETITOR_JPG,
      'https://www.facebook.com/ads/library/?id=1',
      'https://scontent-mxp1-1.cdninstagram.com/x.jpg',
      'https://v16.tiktokcdn.com/x.mp4'
    ]) {
      expect(isThirdPartyAdMediaUrl(u)).toBe(true);
    }
  });

  it('leaves our own storage alone', () => {
    for (const u of [OUR_MP4, OUR_JPG, 'https://cdn.mybrand.com/a.jpg', '', 'not a url']) {
      expect(isThirdPartyAdMediaUrl(u)).toBe(false);
    }
  });

  it('onlyOwnMediaUrls drops third-party urls, dedupes and keeps ours', () => {
    expect(onlyOwnMediaUrls([COMPETITOR_MP4, OUR_MP4, OUR_MP4, null, 'ftp://x/y.mp4'])).toEqual([
      OUR_MP4
    ]);
  });

  it('a competitor mp4 can NEVER reach a generation, even if it is attached to the brief', () => {
    const brief = makeBrief({ visualPrompt: 'shot brief text from the breakdown' });
    const params = buildRemixProduceParams(brief, {
      // Materiale "sporco" di proposito: prodotti e persone con URL altrui in mezzo.
      products: [{ id: 'p1', name: 'Capy60', urls: [COMPETITOR_JPG, OUR_JPG] }],
      people: [{ id: 'h1', name: 'Ada', urls: [COMPETITOR_JPG] }],
      videoUrls: [COMPETITOR_MP4, OUR_MP4]
    });
    const flat = JSON.stringify(params);
    expect(flat).not.toContain('fbcdn.net');
    expect(flat).not.toContain('cdninstagram');
    expect(params.referenceVideoUrls).toEqual([OUR_MP4]);
    expect(params.products).toEqual([{ id: 'p1', name: 'Capy60', urls: [OUR_JPG] }]);
    // La persona restava senza una sola foto nostra: sparisce, non passa con l'URL altrui.
    expect(params.models).toEqual([]);
  });

  it('carries the brief text into the prompt — that is all that survives of their video', () => {
    const params = buildRemixProduceParams(
      makeBrief({ hook: 'Il tuo desk è un cantiere', visualPrompt: 'BEAT 0-2s: hands enter frame' }),
      { products: [], people: [], videoUrls: [] }
    );
    expect(String(params.prompt)).toContain('Il tuo desk è un cantiere');
    expect(String(params.prompt)).toContain('BEAT 0-2s: hands enter frame');
    expect(params.referenceVideoUrls).toEqual([]);
  });
});

describe('buildRemixPrompt with a breakdown', () => {
  it('hands the model the second-by-second timeline as TEXT, never the mp4', () => {
    const pool = [ad('a1', { videoUrl: COMPETITOR_MP4 })];
    const prompt = buildRemixPrompt({
      brandName: 'Acme',
      kit: {},
      products: [],
      ads: pool,
      breakdowns: new Map([['a1', 'SUBJECT: woman\nTIMELINE:\n0-2s hands enter frame']])
    });
    expect(prompt).toContain('shot breakdown');
    expect(prompt).toContain('0-2s hands enter frame');
    expect(prompt).not.toContain(COMPETITOR_MP4);
  });
});

describe('composeRemixVisualPrompt', () => {
  it('without a breakdown it is just the agent sentence, capped', () => {
    expect(composeRemixVisualPrompt(null, '  a   clean  line ')).toBe('a clean line');
    expect(composeRemixVisualPrompt('', 'x'.repeat(900))).toHaveLength(600);
  });

  it('with a breakdown the second-by-second brief becomes the structure', () => {
    const out = composeRemixVisualPrompt(
      'SUBJECT: woman, kitchen\nTIMELINE:\n0-2s hands enter frame',
      'our founder unboxing the Capy60'
    );
    expect(out).toContain('0-2s hands enter frame');
    expect(out).toContain('our founder unboxing the Capy60');
    // La riga che impedisce che una struttura rubata diventi una creatività clonata.
    expect(out).toContain('CAST & PRODUCT ARE OURS');
  });
});

describe('digestToNormalizedAd', () => {
  it('carries the ad video url for the text breakdown only', () => {
    const mapped = digestToNormalizedAd({
      id: '9',
      pageName: 'Rival',
      body: '',
      title: '',
      ctaText: '',
      linkUrl: '',
      isActive: true,
      startDate: null,
      platforms: [],
      mediaType: 'video',
      imageUrl: null,
      videoUrl: COMPETITOR_MP4
    });
    expect(mapped.videoUrl).toBe(COMPETITOR_MP4);
    // ...e non finisce comunque su nessuna colonna del brief.
    const row = remixBriefRow('b1', makeBrief({ sourceAdId: '9' }));
    expect(JSON.stringify(row)).not.toContain('fbcdn.net');
  });
});

function makeBrief(overrides: Partial<RemixBrief> = {}): RemixBrief {
  return {
    id: 'br1',
    sourceAdId: 'a1',
    sourcePageName: 'Rival',
    sourceBody: null,
    sourceThumbnail: null,
    sourceLibraryUrl: 'https://www.facebook.com/ads/library/?id=a1',
    rank: 1,
    strategy: 's',
    keep: 'the 2s call-out',
    change: 'our product',
    hook: 'hook',
    headline: 'headline',
    body: 'body',
    cta: 'Shop now',
    productName: 'Capy60',
    visualPrompt: 'vp',
    status: 'proposed',
    ...overrides
  };
}
