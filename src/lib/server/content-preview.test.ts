import { describe, it, expect } from 'vitest';
import { brandVisualDirective, platformPlaybook, normalizeWeeklyStrategy, attachBrandMoodImages, extractVisualPlaybook, carouselMaxPerBatch, carouselMaxSlides, clampCarousels, resolveSeedWithRubrics, faceBrandMode, scrubPersonAppearance, aspectRatioFor, seedToPost, buildImageRequest, enforceHookComponents, detectSceneCollapse, detectCaptionTells, detectCtaEcho, findJudgeDuplicates, ownerCaptionEditPairs, ownerEditPairsBlock, postQcPayload, sealOnImageText, applySeedFix, BLOG_IMAGE_MODEL, type PostSeed, type PreviewPost } from './content-preview';

import type { Rubric } from './rubrics';

describe('normalizeWeeklyStrategy (platform media capabilities)', () => {
  const seed = (over: Record<string, unknown> = {}) => ({
    platform: 'x', platforms: ['x'], format: 'post', media: 'image',
    day: 'Monday', time: '09:00', product: '', person: '', angle: 'a', subject: 's', setting: '', props: '',
    ...over
  });

  it('flips a text-only seed on a visual-required platform (Instagram) to image', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [seed({ platform: 'instagram', platforms: ['instagram'], media: 'text' })] });
    expect(out.seeds[0].media).toBe('image');
  });

  it('keeps text-only on X/Threads but strips visual-required cross-post targets', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [seed({ media: 'text', platforms: ['x', 'instagram', 'threads'] })] });
    expect(out.seeds[0].media).toBe('text');
    expect(out.seeds[0].platforms).toEqual(['x', 'threads']);
  });

  it('leaves image posts free to cross-post anywhere requested', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [seed({ platform: 'instagram', platforms: ['instagram', 'facebook'] })] });
    expect(out.seeds[0].platforms).toEqual(['instagram', 'facebook']);
  });

  it('keeps a caption link on X but drops it on Instagram (not clickable)', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [
      seed({ platform: 'x', platforms: ['x'], link_url: 'https://b.co/wiki/a' }),
      seed({ platform: 'instagram', platforms: ['instagram'], link_url: 'https://b.co/wiki/a' })
    ] });
    expect(out.seeds[0].link_url).toBe('https://b.co/wiki/a');
    expect(out.seeds[1].link_url).toBe('');
  });

  it('maps legacy free-form formats onto the ContentFormat enum (unknown → single_image)', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [
      seed({ format: 'reel' }),
      seed({ format: 'story' }),
      seed({ format: 'short video' }),
      // On a carousel-capable platform (the platform clamp would downgrade it on X).
      seed({ platform: 'instagram', platforms: ['instagram'], format: 'carousel' }),
      seed({ format: undefined }),
      seed({ format: 'garbage-value' })
    ] });
    expect(out.seeds.map((s) => s.format)).toEqual([
      'video', 'single_image', 'video', 'carousel', 'single_image', 'single_image'
    ]);
  });

  it('pairs format:video with media:video (legacy rows that only had format reel)', () => {
    const out = normalizeWeeklyStrategy({
      theme: 't',
      rationale: 'r',
      do_dont: '',
      seeds: [seed({ platform: 'tiktok', platforms: ['tiktok'], format: 'reel', media: 'image' })]
    });
    expect(out.seeds[0].format).toBe('video');
    expect(out.seeds[0].media).toBe('video');
  });

  it('forces YouTube seeds to video (Shorts vs long-form is not a separate platform)', () => {
    const out = normalizeWeeklyStrategy({
      theme: 't', rationale: 'r', do_dont: '',
      seeds: [seed({ platform: 'youtube', platforms: ['youtube', 'instagram'], format: 'single_image', media: 'image' })]
    });
    expect(out.seeds[0].format).toBe('video');
    expect(out.seeds[0].media).toBe('video');
  });

  it('strips YouTube from the cross-post list of a still', () => {
    const out = normalizeWeeklyStrategy({
      theme: 't', rationale: 'r', do_dont: '',
      seeds: [seed({ platform: 'instagram', platforms: ['instagram', 'youtube'], media: 'image' })]
    });
    expect(out.seeds[0].platforms).toEqual(['instagram']);
  });

  it('preserves UGC spoken script (hook/body/cta) and ugc flag across DB rehydrate', () => {
    const out = normalizeWeeklyStrategy({
      theme: 't',
      rationale: 'r',
      do_dont: '',
      seeds: [
        seed({
          platform: 'instagram',
          platforms: ['instagram'],
          format: 'video',
          media: 'video',
          ugc: true,
          hook: 'Se paghi un SMM stai buttando soldi.',
          body: "Ho chiuso l'agenzia. Ora è un'AI.",
          cta: 'Provala e contraddicimi.',
          setting: 'messy kitchen at night'
        })
      ]
    });
    const s = out.seeds[0];
    expect(s.format).toBe('video');
    expect(s.media).toBe('video');
    expect(s.ugc).toBe(true);
    expect(s.hook).toBe('Se paghi un SMM stai buttando soldi.');
    expect(s.body).toBe("Ho chiuso l'agenzia. Ora è un'AI.");
    expect(s.cta).toBe('Provala e contraddicimi.');
    expect(s.setting).toBe('messy kitchen at night');
  });

  it('defaults ugc to true on video seeds when the stored flag is missing', () => {
    const out = normalizeWeeklyStrategy({
      theme: 't',
      rationale: 'r',
      do_dont: '',
      seeds: [seed({ platform: 'tiktok', platforms: ['tiktok'], format: 'video', media: 'video', hook: 'H.', body: 'B.', cta: 'C.' })]
    });
    expect(out.seeds[0].ugc).toBe(true);
  });

  it('keeps a carousel on Instagram and clamps slide_count into range', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [
      seed({ platform: 'instagram', platforms: ['instagram'], format: 'carousel', slide_count: 12 }),
      seed({ platform: 'instagram', platforms: ['instagram'], format: 'carousel', slide_count: 1 }),
      seed({ platform: 'instagram', platforms: ['instagram'], format: 'carousel' })
    ] });
    expect(out.seeds.map((s) => s.format)).toEqual(['carousel', 'carousel', 'carousel']);
    expect(out.seeds[0].slide_count).toBe(carouselMaxSlides()); // over the max → clamped down
    expect(out.seeds[1].slide_count).toBe(3); // below the min → clamped up
    expect(out.seeds[2].slide_count).toBe(5); // missing → default
  });

  it('downgrades a carousel on a non-carousel platform and filters cross-post targets', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [
      seed({ platform: 'x', platforms: ['x'], format: 'carousel', slide_count: 5 }),
      seed({ platform: 'instagram', platforms: ['instagram', 'x', 'facebook'], format: 'carousel', slide_count: 4 })
    ] });
    expect(out.seeds[0].format).toBe('single_image');
    expect(out.seeds[0].slide_count).toBeUndefined();
    expect(out.seeds[1].format).toBe('carousel');
    expect(out.seeds[1].platforms).toEqual(['instagram', 'facebook']); // X filtered out
  });

  it('keeps format coherent with media (text → text_post; image never keeps text_post)', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [
      seed({ media: 'text', format: 'post' }),
      seed({ media: 'image', format: 'text post' }),
      seed({ platform: 'reddit', platforms: ['reddit'], media: 'link', format: 'post', link_url: 'https://b.co/a' })
    ] });
    expect(out.seeds[0].format).toBe('text_post');
    expect(out.seeds[1].format).toBe('single_image');
    expect(out.seeds[2].format).toBe('link_post');
  });
});

describe('seedToPost (UGC script survives seed → PreviewPost)', () => {
  const mkSeed = (over: Partial<PostSeed> = {}): PostSeed => ({
    platform: 'instagram',
    platforms: ['instagram'],
    pillar: 'p',
    format: 'video',
    media: 'video',
    day: 'Monday',
    time: '09:00',
    title: '',
    link_url: '',
    subreddit: '',
    product: 'Anomalia',
    person: 'Andrea',
    angle: 'a',
    subject: 's',
    setting: 'home office',
    props: '',
    ugc: true,
    hook: 'Hook claim.',
    body: 'Body proof.',
    cta: 'CTA bait.',
    ...over
  });

  it('copies hook/body/cta/ugc/setting onto the PreviewPost for video seeds', () => {
    const post = seedToPost(mkSeed());
    expect(post.format).toBe('video');
    expect(post.media).toBe('video');
    expect(post.ugc).toBe(true);
    expect(post.hook).toBe('Hook claim.');
    expect(post.body).toBe('Body proof.');
    expect(post.cta).toBe('CTA bait.');
    expect(post.setting).toBe('home office');
    expect(post.person).toBe('Andrea');
    expect(post.product).toBe('Anomalia');
  });

  it('defaults ugc to true when the seed omitted the flag', () => {
    const post = seedToPost(mkSeed({ ugc: undefined }));
    expect(post.ugc).toBe(true);
  });

  it('carries ugc_ad for paid ad creatives; defaults false/omit', () => {
    expect(seedToPost(mkSeed()).ugc_ad).toBe(false);
    expect(seedToPost(mkSeed({ ugc_ad: true })).ugc_ad).toBe(true);
  });

  it('does not attach spoken-script fields on non-video seeds', () => {
    const post = seedToPost(mkSeed({ format: 'single_image', media: 'image', ugc: true, hook: 'x' }));
    expect(post.format).toBe('single_image');
    expect(post.ugc).toBeUndefined();
    expect(post.ugc_ad).toBeUndefined();
    expect(post.hook).toBeUndefined();
    expect(post.body).toBeUndefined();
    expect(post.cta).toBeUndefined();
  });
});
describe('resolveSeedWithRubrics (rubric format is AUTHORITATIVE over Pass 1)', () => {
  const mkSeed = (over: Partial<PostSeed> = {}): PostSeed => ({
    platform: 'reddit', platforms: ['reddit'], pillar: 'p', format: 'single_image', media: 'image',
    day: 'Monday', time: '09:00', title: '', link_url: '', subreddit: '', product: '', person: '',
    angle: 'a', subject: 's', setting: '', props: '', ...over
  });
  const mkRubric = (over: Partial<Rubric> = {}): Rubric => ({
    id: 'r-link', name: 'Formula Km 0', promise: 'p', strategic_role: 'traffic',
    format: 'link_post', cadence: '2/month', differentiation: 'd', rationale: 'r', ...over
  });

  // THE case: the rubric says link_post, Pass 1 proposed carousel (media image). If Pass 1 won
  // here, rubrics would have recreated the exact drift they exist to prevent.
  it('link_post rubric beats a Pass-1 carousel proposal (format AND media)', () => {
    const seed = mkSeed({ platform: 'reddit', platforms: ['reddit'], format: 'carousel', slide_count: 5, media: 'image', rubric: 'Formula Km 0', link_url: 'https://b.co/a' });
    const out = resolveSeedWithRubrics(seed, [mkRubric()]);
    expect(out.format).toBe('link_post');
    expect(out.media).toBe('link');
    expect(out.rubric_id).toBe('r-link');
    expect(out.slide_count).toBeUndefined(); // no carousel remnants
  });

  it('carousel rubric beats a Pass-1 single_image proposal (gets a slide_count)', () => {
    const out = resolveSeedWithRubrics(
      mkSeed({ platform: 'instagram', platforms: ['instagram'], format: 'single_image', media: 'image', rubric: 'Serie C' }),
      [mkRubric({ id: 'r-car', name: 'Serie C', format: 'carousel' })]
    );
    expect(out.format).toBe('carousel');
    expect(out.media).toBe('image');
    expect(out.slide_count).toBe(5);
  });

  it('text_post rubric beats a Pass-1 image proposal on X', () => {
    const out = resolveSeedWithRubrics(
      mkSeed({ platform: 'x', platforms: ['x'], format: 'single_image', media: 'image', rubric: 'Serie T' }),
      [mkRubric({ id: 'r-txt', name: 'Serie T', format: 'text_post' })]
    );
    expect(out.format).toBe('text_post');
    expect(out.media).toBe('text');
  });

  // Residual divergence is PLATFORM PHYSICS, not Pass 1 winning: a link_post episode cannot
  // exist on Instagram (links aren't clickable) — it degrades, and keeps the rubric linkage
  // so the degradation is traceable (and logged by resolveSeedWithRubrics).
  it('degrades a link_post episode on Instagram (platform capability, traceable)', () => {
    const out = resolveSeedWithRubrics(
      mkSeed({ platform: 'instagram', platforms: ['instagram'], format: 'carousel', media: 'image', rubric: 'Formula Km 0' }),
      [mkRubric()]
    );
    expect(out.format).toBe('single_image');
    expect(out.media).toBe('image');
    expect(out.rubric_id).toBe('r-link'); // linkage survives → the mismatch is visible downstream
  });
});

describe('carousel guardrail config', () => {
  // Il tetto per batch era 1 e faceva la scelta editoriale al posto di chi pianifica: una rubrica a
  // fumetti usciva di rado perché il numero le stava davanti, non perché costasse troppo. Il vincolo
  // vero ora è il budget (un carosello costa quante slide ha, un video ne vale sedici) e questo resta
  // un freno d'emergenza. Il tetto alle SLIDE invece è fisico: oltre non si pubblica.
  it('non decide più quanti caroselli, ma tiene il tetto fisico alle slide', () => {
    expect(carouselMaxPerBatch()).toBeGreaterThan(1);
    expect(carouselMaxSlides()).toBe(6);
  });
});

describe('brandVisualDirective', () => {
  // Un poster tipografico è tornato con "#E86A5C" e "#3B6FB6" stampati dentro: al renderer i codici
  // sono arrivati come testo, e un design fatto di testo li ha letterizzati.
  it('vieta di stampare i codici colore dentro l\'immagine', () => {
    const d = brandVisualDirective(['#E86A5C', '#3B6FB6'], null);
    expect(d).toMatch(/never (?:draw|render|letter)[^.]*code/i);
  });

  it('builds a palette + typography directive', () => {
    const d = brandVisualDirective(['#0099FF', '#111111'], ['Inter', 'Söhne']);
    expect(d).toMatch(/BRAND IDENTITY/);
    expect(d).toContain('#0099FF');
    expect(d).toContain('#111111');
    expect(d).toContain('Inter');
    expect(d).toContain('Söhne');
  });

  it('returns empty when there are no colours or fonts', () => {
    expect(brandVisualDirective([], [])).toBe('');
    expect(brandVisualDirective(null, null)).toBe('');
    expect(brandVisualDirective(undefined, undefined)).toBe('');
  });

  it('caps the palette at 6 and fonts at 3', () => {
    const colors = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777'];
    const fonts = ['Inter', 'Roboto', 'Lato', 'Poppins'];
    const d = brandVisualDirective(colors, fonts);
    expect(d).toContain('#666666');
    expect(d).not.toContain('#777777');
    expect(d).toContain('Lato');
    expect(d).not.toContain('Poppins');
  });

  it('works with only colours (no fonts)', () => {
    const d = brandVisualDirective(['#0099FF'], []);
    expect(d).toContain('#0099FF');
    expect(d).not.toMatch(/Typography/);
  });
});

describe('platformPlaybook', () => {
  it('steers LinkedIn toward long-form copy', () => {
    const out = platformPlaybook(['linkedin'], {});
    expect(out).toMatch(/PLATFORM PLAYBOOK/);
    expect(out).toMatch(/LinkedIn/);
    expect(out).toMatch(/LONG-FORM/);
  });

  it('dedupes platforms and maps twitter → x', () => {
    const out = platformPlaybook(['x', 'twitter', 'x'], {});
    // One bullet only, despite three (equivalent) entries.
    expect(out.match(/^- /gm)?.length).toBe(1);
    expect(out).toMatch(/280 characters/);
  });

  it('layers brand-specific instructions on top of the default, marked authoritative', () => {
    const out = platformPlaybook(['linkedin'], {
      platformInstructions: { linkedin: 'Always end with a poll.' }
    });
    expect(out).toMatch(/LONG-FORM/); // default still present
    expect(out).toContain('Always end with a poll.');
    expect(out).toMatch(/take priority/);
  });

  it('returns empty when no listed platform has guidance', () => {
    expect(platformPlaybook([], {})).toBe('');
    expect(platformPlaybook(['', '   '], {})).toBe('');
    // An unknown platform with no custom instructions contributes nothing.
    expect(platformPlaybook(['myspace'], {})).toBe('');
  });

  it('includes an unknown platform when the brand supplies custom instructions', () => {
    const out = platformPlaybook(['myspace'], { platformInstructions: { myspace: 'Keep it retro.' } });
    expect(out).toContain('Keep it retro.');
  });

  it('constrains hashtags to the brand-approved set when provided', () => {
    const out = platformPlaybook(['instagram'], { platformHashtags: { instagram: ['#brand', '#promo'] } });
    expect(out).toContain('#brand #promo');
    expect(out).toContain('use ONLY these brand-approved hashtags');
    // No approved set for a platform → no hashtag constraint line.
    expect(platformPlaybook(['x'], { platformHashtags: { instagram: ['#brand'] } })).not.toContain('use ONLY these');
  });

  it('documents YouTube as video-only with auto Shorts detection', () => {
    const out = platformPlaybook(['youtube'], {});
    expect(out).toMatch(/YouTube/i);
    expect(out).toMatch(/video-only/i);
    expect(out).toMatch(/Short/i);
  });
});

describe('attachBrandMoodImages (site-image fallback)', () => {
  // Minimal supabase stub: brand_documents query resolves to the given rows.
  const supabaseWithMoodDocs = (rows: { file_url: string }[]) =>
    ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({ limit: async () => ({ data: rows }) })
            })
          })
        })
      }),
      storage: {
        from: () => ({
          createSignedUrls: async (paths: string[]) => ({
            data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` }))
          })
        })
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

  it('falls back to the brand site imagery when there are no uploaded mood docs', async () => {
    const profile = { images: ['https://site/a.jpg', 'https://site/b.jpg', 'https://site/c.jpg', 'https://site/d.jpg'] };
    await attachBrandMoodImages(profile, supabaseWithMoodDocs([]), 'brand-1');
    // Capped at MOOD_REF_IMAGES (3) and taken in site order.
    expect((profile as { moodImages?: string[] }).moodImages).toEqual([
      'https://site/a.jpg', 'https://site/b.jpg', 'https://site/c.jpg'
    ]);
  });

  it('prefers uploaded mood docs over site imagery', async () => {
    const profile = { images: ['https://site/a.jpg'] };
    await attachBrandMoodImages(profile, supabaseWithMoodDocs([{ file_url: 'u/mood.png' }]), 'brand-1');
    expect((profile as { moodImages?: string[] }).moodImages).toEqual(['https://signed/u/mood.png']);
  });

  it('leaves an already-populated moodImages untouched', async () => {
    const profile = { moodImages: ['keep.png'], images: ['https://site/a.jpg'] };
    await attachBrandMoodImages(profile, supabaseWithMoodDocs([]), 'brand-1');
    expect((profile as { moodImages?: string[] }).moodImages).toEqual(['keep.png']);
  });
});

describe('extractVisualPlaybook', () => {
  const playbook =
    'WHAT WORKS VISUALLY (from the brand\'s best-performing posts — repeat these patterns):\n- Close-up product textures\n- Warm natural light';

  it('pulls the WHAT WORKS VISUALLY section out of a composite ai_context', () => {
    const ctx = `Voice brief here.\n\n${playbook}\n\nCOMPETITIVE DELTA (how to stand out):\nLean into: X.`;
    expect(extractVisualPlaybook(ctx)).toBe(playbook);
  });

  it('works when the block is the last section', () => {
    const ctx = `Voice brief here.\n\n${playbook}`;
    expect(extractVisualPlaybook(ctx)).toBe(playbook);
  });

  it('returns empty when the block is absent or input is not a string', () => {
    expect(extractVisualPlaybook('Just a voice brief.')).toBe('');
    expect(extractVisualPlaybook(undefined)).toBe('');
    expect(extractVisualPlaybook(null)).toBe('');
  });
});

describe('scrubPersonAppearance', () => {
  it('strips gendered physique invented for androgenous names', () => {
    expect(scrubPersonAppearance('A young man named Andrea smiling in a studio')).toMatch(/the person/i);
    expect(scrubPersonAppearance('A young man named Andrea smiling in a studio')).not.toMatch(/\bman\b/i);
    expect(scrubPersonAppearance('Portrait of a woman in a navy blazer at a desk')).toMatch(/navy blazer/i);
    expect(scrubPersonAppearance('Portrait of a woman in a navy blazer at a desk')).not.toMatch(/\bwoman\b/i);
  });
});

describe('faceBrandMode', () => {
  it('returns none with no people', () => {
    expect(faceBrandMode({ name: 'Acme', people: [] } as any)).toBe('none');
  });

  it('treats a single person as face (monopersonal default)', () => {
    expect(faceBrandMode({ name: 'Studio X', people: [{ name: 'Marco' }] } as any)).toBe('face');
  });

  it('detects personal site via name overlap (e.g. andreabuttarelli.com)', () => {
    expect(
      faceBrandMode({
        name: 'Andrea Buttarelli',
        site_type: 'portfolio',
        people: [{ name: 'Andrea Buttarelli' }]
      } as any)
    ).toBe('face');
  });

  it('treats 3+ people as ensemble even on a personal archetype', () => {
    expect(
      faceBrandMode({
        name: 'Acme',
        site_type: 'creator',
        people: [{ name: 'A' }, { name: 'B' }, { name: 'C' }]
      } as any)
    ).toBe('ensemble');
  });

  it('keeps a 2-person company as ensemble without personal signals', () => {
    expect(
      faceBrandMode({
        name: 'Acme Co',
        site_type: 'saas',
        about: 'We build tools for teams.',
        people: [{ name: 'Alice' }, { name: 'Bob' }]
      } as any)
    ).toBe('ensemble');
  });
});

describe('aspectRatioFor', () => {
  it('keeps stills feed-safe per platform', () => {
    expect(aspectRatioFor('instagram')).toBe('4:5');
    expect(aspectRatioFor('x')).toBe('16:9');
    expect(aspectRatioFor('tiktok')).toBe('9:16');
    expect(aspectRatioFor('youtube')).toBe('9:16');
    expect(aspectRatioFor('reddit')).toBe('1:1');
  });

  it('forces 9:16 for video covers on every platform — the clip inherits the cover ratio', () => {
    expect(aspectRatioFor('instagram', 'video')).toBe('9:16');
    expect(aspectRatioFor('x', 'video')).toBe('9:16');
    // legacy free-form formats normalise to 'video' too
    expect(aspectRatioFor('instagram', 'reel')).toBe('9:16');
    expect(aspectRatioFor('instagram', 'short video')).toBe('9:16');
  });

  it('leaves non-video formats on the platform ratio', () => {
    expect(aspectRatioFor('instagram', 'carousel')).toBe('4:5');
    expect(aspectRatioFor('instagram', 'single_image')).toBe('4:5');
  });
});

describe('buildImageRequest (image model tier)', () => {
  const LITE = 'gemini-3.1-flash-lite-image';
  const img = { inlineData: { mimeType: 'image/png', data: 'x' } };

  it('default render model is Nano Banana 2 Lite, also with reproduction refs', () => {
    expect(buildImageRequest('p', { personImages: [img] }).model).toBe(LITE);
    expect(buildImageRequest('p', { referenceImages: [img] }).model).toBe(LITE);
    expect(buildImageRequest('p', { userRefImages: [img] }).model).toBe(LITE);
    expect(buildImageRequest('p', { baseImage: img }).model).toBe(LITE);
  });

  it('drops to the half-price tier with no reproduction refs — mood and logo do not count', () => {
    expect(buildImageRequest('p', {}).model).toBe(BLOG_IMAGE_MODEL);
    expect(buildImageRequest('p', { moodImages: [img], logoImage: img }).model).toBe(BLOG_IMAGE_MODEL);
  });

  it('a base image is an EDIT, and the brand can edit with another model', () => {
    // Editing the photo the user is looking at and inventing one from a prompt are two jobs, and
    // the brand picks a model for each. This is the only place that knows which one is happening.
    expect(buildImageRequest('p', { model: 'draw', refineModel: 'edit', baseImage: img }).model).toBe('edit');
  });

  it('does not reach for the refine model when there is nothing to refine', () => {
    // Reference or mood images are things to REPRODUCE, not a base to edit: sending those through
    // the refine model would quietly retire the brand's generation choice on half its posts.
    expect(buildImageRequest('p', { model: 'draw', refineModel: 'edit' }).model).toBe('draw');
    expect(buildImageRequest('p', { model: 'draw', refineModel: 'edit', referenceImages: [img] }).model).toBe('draw');
  });

  it('never overrides an explicit caller model (blog/batch/UGC)', () => {
    expect(buildImageRequest('p', { model: 'x', personImages: [img] }).model).toBe('x');
  });

  // Il tetto dei riferimenti non è una scelta di prodotto libera: kie è la rotta di default e ne
  // inoltra 8 IN TUTTO, contando anche quelli che nessuno ha chiesto (logo, base, mood). Chiunque
  // alzi un limite negli strumenti (`generate_image` e i suoi quattro gemelli) deve passare da qui:
  // se la somma supera KIE_IMAGE_INPUT_MAX il taglio non sparisce, si sposta soltanto dentro kie,
  // dove non ha nemmeno il nome delle immagini che butta via.
  it('la somma delle parti allegate può già superare quello che kie inoltra', async () => {
    const { KIE_IMAGE_INPUT_MAX } = await import('./kie-jobs');
    const inlineParts = (opts: Parameters<typeof buildImageRequest>[1]) =>
      buildImageRequest('p', opts).contents[0].parts.filter((x: { inlineData?: unknown }) => x.inlineData).length;

    // Il caso peggiore che il codice di oggi sa costruire: base + logo + 4 prodotto + 4 allegati + 3 mood.
    const worst = inlineParts({
      baseImage: img,
      logoImage: img,
      referenceImages: [img, img, img, img],
      userRefImages: [img, img, img, img],
      moodImages: [img, img, img]
    });
    expect(worst).toBe(13);
    expect(worst).toBeGreaterThan(KIE_IMAGE_INPUT_MAX);

    // E il costo fisso che l'utente non controlla: logo sempre, base in modifica, mood fino a 3.
    // Quello che resta a chi passa reference_image_urls / people_ids / media_ids è questo, non 12.
    const fixed = inlineParts({ baseImage: img, logoImage: img, moodImages: [img, img, img] });
    expect(fixed).toBe(5);
    expect(KIE_IMAGE_INPUT_MAX - fixed).toBe(3);
  });
});

describe('replaceMarkdownImageUrl', () => {
  it('swaps the matching image URL in markdown and leaves others alone', async () => {
    const { replaceMarkdownImageUrl } = await import('./content-preview');
    const md = '# Hi\n\n![a](https://cdn.example/old.png)\n\nText\n\n![b](https://cdn.example/keep.png)\n';
    const out = replaceMarkdownImageUrl(md, 'https://cdn.example/old.png', 'https://cdn.example/new.png');
    expect(out).toContain('![a](https://cdn.example/new.png)');
    expect(out).toContain('![b](https://cdn.example/keep.png)');
    expect(out).not.toContain('https://cdn.example/old.png');
  });

  it('is a no-op when urls are empty or identical', async () => {
    const { replaceMarkdownImageUrl } = await import('./content-preview');
    const md = '![x](https://cdn.example/a.png)';
    expect(replaceMarkdownImageUrl(md, '', 'https://cdn.example/b.png')).toBe(md);
    expect(replaceMarkdownImageUrl(md, 'https://cdn.example/a.png', 'https://cdn.example/a.png')).toBe(md);
  });
});

describe('enforceHookComponents (the no-duplication rule)', () => {
  it('drops an on-screen line that restates the spoken hook', () => {
    const seeds = [{ hook: 'Ho smesso di mandare report ai clienti', hook_text: 'ho smesso di mandare report ai clienti' }];
    expect(enforceHookComponents(seeds)).toBe(1);
    expect(seeds[0].hook_text).toBe('');
  });

  it('catches an overlay that is a short excerpt of the spoken line', () => {
    // Low overlap with the sentence it was cut from, but a full duplicate of itself — which is why
    // the ratio is measured against the SHORTER side.
    const seeds = [
      {
        hook: 'Ho smesso di mandare report ai clienti e nessuno se ne e accorto per due mesi interi',
        hook_text: 'smesso mandare report'
      }
    ];
    expect(enforceHookComponents(seeds)).toBe(1);
    expect(seeds[0].hook_text).toBe('');
  });

  it('keeps an overlay that carries a different load', () => {
    const seeds = [{ hook: 'Ho smesso di mandare report ai clienti', hook_text: 'agenzie: leggete questo' }];
    expect(enforceHookComponents(seeds)).toBe(0);
    expect(seeds[0].hook_text).toBe('agenzie: leggete questo');
  });

  it('ignores accents and punctuation when comparing', () => {
    const seeds = [{ hook: 'Perche i preventivi muoiono?', hook_text: 'Perché i preventivi muoiono' }];
    expect(enforceHookComponents(seeds)).toBe(1);
  });

  it('leaves a seed alone when either slot is empty', () => {
    const seeds = [{ hook: 'Qualcosa', hook_text: '' }, { hook: '', hook_text: 'Qualcosa' }];
    expect(enforceHookComponents(seeds)).toBe(0);
    expect(seeds[1].hook_text).toBe('Qualcosa');
  });
});

describe('clampVideos + the fidelity ladder', () => {
  // clampVideos is internal, so the allocation rule is proven through the two exported helpers it
  // delegates to: the same classify → rank pipeline decides which clip survives the cap.
  it('keeps the clip whose angle earned the spend when the cap bites', async () => {
    const { classifyHookTactic } = await import('./hook-tactics');
    const { byLadderPriority, ladderFor } = await import('./production-ladder');
    const ctx = { proven: ['stat_lead' as const], tried: ['stat_lead' as const, 'question' as const], coldStart: false };
    const seeds = [
      { id: 'never-tried', hook: 'Nota: ho smesso di mandare report' },
      { id: 'proven', hook: '68% dei preventivi si perde nelle prime 48 ore' },
      { id: 'tried', hook: 'Vuoi davvero continuare così?' }
    ];
    const ordered = byLadderPriority(seeds, (s) => ladderFor(classifyHookTactic(s.hook)?.tactic ?? null, ctx).rung);
    expect(ordered.map((s) => s.id)).toEqual(['proven', 'tried', 'never-tried']);
  });
});

// La guardia anti-collasso del contratto a due livelli: con la scena consultiva, questo è l'unico
// argine tecnico al vecchio fallimento "N scatti prodotto quasi identici".
describe('detectSceneCollapse', () => {
  it('fires on a collapsed batch (near-identical prompt openings)', () => {
    const idx = detectSceneCollapse([
      'Photorealistic product shot of the serum bottle on a marble counter, soft morning light',
      'Photorealistic product shot of the serum bottle on a marble counter, warm morning light',
      'Photorealistic product shot of the serum bottle on the marble counter, soft light',
      'Hands ripping a printed report in half, harsh flash, office at night'
    ]);
    expect(idx).toEqual([0, 1, 2]);
  });

  it('stays quiet on a varied batch', () => {
    expect(
      detectSceneCollapse([
        'Photorealistic product shot of the serum bottle on a marble counter, soft morning light',
        'Founder mid-laugh at a cluttered standing desk, candid wide angle',
        'Flat-lay editorial collage of customer notes and polaroids on kraft paper',
        'Macro of water droplets on a green leaf, dark background'
      ])
    ).toEqual([]);
  });

  it('ignores empty prompts (text/link posts) and pairs below the cluster minimum', () => {
    expect(detectSceneCollapse(['', '', 'same opening words here now', 'same opening words here now'])).toEqual([]);
  });
});

// I tell da AI si contano in codice: ogni assert qui sotto è un fallimento nominato in
// CAPTION_FAILURE_MODES, e se il detector si rompe il copy chief torna cieco sulla cadenza.
describe('detectCaptionTells (le spie deterministiche del copy chief)', () => {
  it('flags the em-dash cadence, tricolon ending and banned opener together', () => {
    const tells = detectCaptionTells(
      'Scopri come il tuo brand può crescere davvero — senza sprechi — senza stress.\nNon promesse. Non slide. Solo risultati.'
    );
    expect(tells).toContain('em_dash:2');
    expect(tells).toContain('banned_opener');
    expect(tells).toContain('tricolon_ending');
  });

  it('caps emoji at 2 (0 on LinkedIn) and flags a first line that rambles', () => {
    expect(detectCaptionTells('Grande novità 🎉🚀🔥 per tutti')).toContain('emoji:3');
    expect(detectCaptionTells('Una novità 🎉', 'linkedin')).toContain('emoji:1');
    const rambling = detectCaptionTells(
      'In questo post vogliamo raccontarvi una cosa che secondo noi è davvero molto interessante per chi ci segue'
    );
    expect(rambling.some((t) => t.startsWith('long_first_line:'))).toBe(true);
  });

  it('stays quiet on a clean caption', () => {
    expect(detectCaptionTells('Tre resi su dieci partono da una taglia sbagliata. Da oggi la tabella è nella foto.')).toEqual([]);
  });
});

describe('detectCtaEcho (CTA fotocopia nel batch)', () => {
  it('fires when two captions close on the same CTA formula, ignoring hashtag tails', () => {
    const idx = detectCtaEcho([
      'Post uno con la sua idea.\nDimmelo nei commenti qui sotto.\n#brand #nicchia',
      'Post due, altra idea.\nDimmelo nei commenti qui sotto.',
      'Post tre chiude senza chiedere niente.'
    ]);
    expect(idx).toEqual([0, 1]);
  });

  it('stays quiet when the closers vary', () => {
    expect(
      detectCtaEcho([
        'Idea uno.\nSalvalo per il prossimo ordine.',
        'Idea due.\nQual è la tua taglia più contestata?',
        'Idea tre. Punto.'
      ])
    ).toEqual([]);
  });
});

// La riscrittura sull'indice sbagliato: due post identici dopo i judge, si ripristina il secondo.
describe('findJudgeDuplicates', () => {
  it('flags the post whose judged caption duplicates another but had a different original', () => {
    expect(findJudgeDuplicates(['stessa caption', 'stessa caption'], ['stessa caption', 'la sua vera caption'])).toEqual([1]);
  });

  it('stays quiet when the duplicate was already there pre-judge, or captions differ', () => {
    expect(findJudgeDuplicates(['uguale', 'uguale'], ['uguale', 'uguale'])).toEqual([]);
    expect(findJudgeDuplicates(['a', 'b', ''], ['x', 'y', 'z'])).toEqual([]);
  });
});

// Il loop di apprendimento: zero coppie → prompt identico a prima; jsonb sporco → mai nel prompt.
describe('ownerCaptionEditPairs / ownerEditPairsBlock', () => {
  it('returns an empty block with zero edits (the prompt stays byte-identical)', () => {
    expect(ownerEditPairsBlock({})).toBe('');
    expect(ownerEditPairsBlock({ captionEditPairs: [] })).toBe('');
  });

  it('sanitizes foreign jsonb: drops invalid pairs, keeps the last 3, truncates to 600 chars', () => {
    const pairs = [
      { before: 'a1', after: 'b1' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { before: '', after: 'x' } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      'garbage' as any,
      { before: 'a2', after: 'b2' },
      { before: 'a3', after: 'x'.repeat(2000) },
      { before: 'a4', after: 'b4' }
    ];
    const out = ownerCaptionEditPairs({ captionEditPairs: pairs });
    expect(out.map((p) => p.before)).toEqual(['a2', 'a3', 'a4']);
    expect(out[1].after.length).toBe(600);
    const block = ownerEditPairsBlock({ captionEditPairs: pairs });
    expect(block).toContain('BEFORE: a4');
    expect(block).toContain('absorb the DIFFERENCE');
  });
});

// posts.qc è l'unico punto di persistenza della deviazione: verdetto immagine e nota devono
// fondersi senza perdersi a vicenda.
describe('postQcPayload', () => {
  it('merges the scene deviation into the image-QC verdict', () => {
    const post = { sceneDeviation: 'stronger scene for the angle' } as PreviewPost;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (post as any).__qc = { score: 8, pass: true };
    expect(postQcPayload(post)).toEqual({ score: 8, pass: true, scene_deviation: 'stronger scene for the angle' });
  });

  it('is just the verdict without a deviation, and null with neither', () => {
    const post = {} as PreviewPost;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (post as any).__qc = { score: 7 };
    expect(postQcPayload(post)).toEqual({ score: 7 });
    expect(postQcPayload({} as PreviewPost)).toBeNull();
    expect(postQcPayload({ sceneDeviation: 'why' } as PreviewPost)).toEqual({ scene_deviation: 'why' });
  });
});

// Un carosello che racconta una storia ha una battuta per slide, decise al piano — non una riga di
// angle da cui il produttore improvvisa N immagini. Le battute devono sopravvivere al giro in DB e
// alla griglia di editing, o l'utente approva una storia che poi nessuno rende.
describe('beats: la storia del carosello sopravvive al round-trip', () => {
  const carousel = (over: Record<string, unknown> = {}) => ({
    platform: 'instagram', platforms: ['instagram'], format: 'carousel', media: 'image',
    day: 'Monday', time: '09:00', product: '', person: '', angle: 'a', subject: 's', setting: '', props: '',
    ...over
  });

  it('porta beats e art_direction attraverso la normalizzazione', () => {
    const beats = [
      { shows: 'lo sportello 4 del CUP', who: 'Sam allo sportello', thinks: 'speriamo legga subito' },
      { shows: 'la finestra di errore sul monitor', who: 'lo schermo, di taglio', thinks: 'ecco, di nuovo' },
      { shows: 'la cornetta alzata', who: "l'operatrice", thinks: 'mezz\'ora, minimo' }
    ];
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [
      carousel({ beats, art_direction: 'fumetto a due colori' })
    ] });
    expect(out.seeds[0].beats).toEqual(beats);
    expect(out.seeds[0].art_direction).toBe('fumetto a due colori');
  });

  // Una battuta senza voce di dentro produce un fumetto muto: si vede cosa succede e non si sa
  // niente di chi lo attraversa. È il difetto che ha bocciato il primo carosello.
  it('legge la vecchia forma a stringa come una battuta senza voce', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [
      carousel({ beats: ['a', 'b', 'c'] })
    ] });
    expect(out.seeds[0].beats).toEqual([
      { shows: 'a', who: '', thinks: '' }, { shows: 'b', who: '', thinks: '' }, { shows: 'c', who: '', thinks: '' }
    ]);
  });

  // La coda del balloon è finita addosso alla protagonista perché nessuno diceva CHI parla: una
  // domanda rivolta a lei è tornata come parole sue, e il senso si è invertito.
  it('tiene il dialogo con chi lo dice, e non lo inventa quando manca', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [
      carousel({ beats: [
        { shows: 'a', who: 'x', thinks: 'b', says: { speaker: 'il corriere', line: 'Ma qui c\'è un altro nome.' } },
        { shows: 'c', who: 'y', thinks: 'd' },
        { shows: 'e', who: 'z', thinks: 'f', says: { speaker: '  ', line: 'orfana' } }
      ] })
    ] });
    expect(out.seeds[0].beats?.[0].says).toEqual({ speaker: 'il corriere', line: 'Ma qui c\'è un altro nome.' });
    expect(out.seeds[0].beats?.[1].says).toBeUndefined();
    expect(out.seeds[0].beats?.[2].says).toBeUndefined();
  });

  // Il generatore riceveva l'azione e indovinava chi mettere in scena: nel riquadro del corriere ha
  // disegnato la protagonista che suona il proprio citofono.
  it('porta chi è nell\'inquadratura', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [
      carousel({ beats: [{ shows: 'a', who: 'il corriere di spalle, Elia sulla porta', thinks: 'b' }] })
    ] });
    expect(out.seeds[0].beats?.[0].who).toBe('il corriere di spalle, Elia sulla porta');
  });

  it('scarta una battuta che non mostra niente', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [
      carousel({ beats: [{ shows: 'a', thinks: 'x' }, { shows: '  ', thinks: 'y' }, { shows: 'c', thinks: 'z' }] })
    ] });
    expect(out.seeds[0].beats).toHaveLength(2);
  });

  it('lo slide_count segue le battute: una storia di 6 battute è un carosello di 6 slide', () => {
    const beats = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [carousel({ beats, slide_count: 3 })] });
    expect(out.seeds[0].slide_count).toBe(6);
  });

  it('taglia le battute al tetto di slide invece di prometterne di più di quante se ne rendano', () => {
    const beats = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9'];
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [carousel({ beats })] });
    expect(out.seeds[0].slide_count).toBe(carouselMaxSlides());
    expect(out.seeds[0].beats).toHaveLength(carouselMaxSlides());
  });

  it('scarta le battute su un seed che non è un carosello', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [
      carousel({ format: 'single_image', beats: ['b1', 'b2'] })
    ] });
    expect(out.seeds[0].beats).toBeUndefined();
  });
});

// Il render riempie da solo una didascalia vuota, e la riempie in inglese: la slide 1 di un
// carosello a fumetti è tornata con «ENTERING ATELIER RIVES — BESPOKE TAILORING» perché il prompt
// chiedeva "hand-lettered caption box" senza dire cosa ci andasse scritto.
describe('sealOnImageText', () => {
  const SEAL = 'Absolutely NO text';

  it('sigilla un prompt che non cita nessuna stringa esatta', () => {
    const out = sealOnImageText('Comic panel of a person opening a shop door. Hand-lettered caption box.');
    expect(out).toContain(SEAL);
  });

  it('lascia stare un prompt che la stringa la cita', () => {
    const p = 'Comic panel with a speech bubble: "Accompagni la sposa?".';
    expect(sealOnImageText(p)).toBe(p);
  });

  it('non sigilla due volte', () => {
    const once = sealOnImageText('Un ritratto senza scritte.');
    expect(sealOnImageText(once)).toBe(once);
  });

  it('non tocca un prompt vuoto (i post di testo non hanno immagine)', () => {
    expect(sealOnImageText('')).toBe('');
  });
});

// clampCarousels declassa un carosello oltre il tetto del batch, e girava DOPO
// clampMediaCapabilities — l'unico posto che sapeva che le battute vivono solo su un carosello.
// Risultato: un'immagine singola che si porta dietro una storia che nessuno renderà mai.
describe('clampCarousels e le battute', () => {
  const carousel = (over: Record<string, unknown> = {}) => ({
    format: 'carousel' as const,
    slide_count: 4,
    beats: ['b1', 'b2', 'b3', 'b4'],
    ...over
  });

  it('porta via la storia insieme al formato', () => {
    const seeds = [carousel(), carousel()];
    clampCarousels(seeds, 1);
    expect(seeds[0].beats).toHaveLength(4);
    expect(seeds[1].format).toBe('single_image');
    expect(seeds[1].beats).toBeUndefined();
  });
});

// Il pass 1.5 ha declassato a immagine singola un episodio di una rubrica CAROSELLO, e nessuno se
// n'è accorto: l'invariante «il formato della rubrica è autoritativo» era applicata nella mappa del
// pass 1 e non dopo la revisione. È costata l'unica rubrica narrativa del batch.
describe('applySeedFix', () => {
  const rubric: Rubric = {
    id: 'r-1', name: 'Cose che succedono davvero', promise: 'p', strategic_role: 'r',
    format: 'carousel', cadence: '1/week', differentiation: 'd', rationale: 'r'
  };
  const seed = (over: Partial<PostSeed> = {}): PostSeed => ({
    platform: 'instagram', platforms: ['instagram'], pillar: 'p', format: 'carousel', slide_count: 4,
    media: 'image', day: 'Mon', time: '10:00', product: '', person: '', angle: 'a', subject: 's',
    setting: '', props: '', rubric: 'Cose che succedono davvero', ...over
  });

  it('la rubrica batte il revisore sul formato', () => {
    const out = applySeedFix(seed(), { format: 'single_image' }, new Set(), [rubric]);
    expect(out.format).toBe('carousel');
  });

  it('senza rubriche il fix del revisore passa', () => {
    const out = applySeedFix(seed({ rubric: undefined }), { format: 'single_image' }, new Set(), []);
    expect(out.format).toBe('single_image');
  });

  it('scarta un prodotto che il brand non ha', () => {
    const out = applySeedFix(seed(), { product: 'Inventato' }, new Set(['reale']), [rubric]);
    expect(out.product).toBe('');
  });

  it('tiene angolo e soggetto riscritti', () => {
    const out = applySeedFix(seed(), { angle: 'nuovo angolo', subject: 'nuovo soggetto' }, new Set(), [rubric]);
    expect(out.angle).toBe('nuovo angolo');
    expect(out.subject).toBe('nuovo soggetto');
  });
});

// Il revisore poteva solo DECLASSARE un carosello senza storia, e così l'unica rubrica narrativa
// del batch usciva come immagine singola. Ora può scriverla, la storia.
describe('applySeedFix scrive le battute mancanti', () => {
  const rubric: Rubric = {
    id: 'r-1', name: 'Cose che succedono davvero', promise: 'p', strategic_role: 'r',
    format: 'carousel', cadence: '1/week', differentiation: 'd', rationale: 'r'
  };
  const seed = (): PostSeed => ({
    platform: 'instagram', platforms: ['instagram'], pillar: 'p', format: 'carousel', slide_count: 3,
    media: 'image', day: 'Mon', time: '10:00', product: '', person: '', angle: 'a', subject: 's',
    setting: '', props: '', rubric: 'Cose che succedono davvero'
  });

  it('accetta le battute scritte dal revisore', () => {
    const out = applySeedFix(seed(), {
      beats: [
        { shows: 'il corriere legge il vecchio nome', who: 'il corriere sulla soglia', thinks: 'ci risiamo' },
        { shows: 'la firma sul palmare', who: 'le mani di Elia', thinks: 'firmo e basta' },
        { shows: 'la porta che si chiude', who: 'Elia di spalle', thinks: 'domani chiamo' }
      ]
    }, new Set(), [rubric]);
    expect(out.beats).toHaveLength(3);
    expect(out.beats?.[0].thinks).toBe('ci risiamo');
    expect(out.format).toBe('carousel');
  });

  it('non tocca le battute quando il revisore non ne manda', () => {
    const before = seed();
    before.beats = [{ shows: 'x', who: 'w', thinks: 'y' }];
    const out = applySeedFix(before, { angle: 'nuovo' }, new Set(), [rubric]);
    expect(out.beats).toEqual([{ shows: 'x', who: 'w', thinks: 'y' }]);
  });
});

// Una battuta narrativa senza fonte è la vita di qualcun altro scritta da un modello su ciò che
// sembra plausibile. La fonte viaggia col seed, si legge nella griglia e si controlla prima di
// approvare — è l'unica cosa che distingue un episodio raccolto da uno inventato.
describe('sourced_from', () => {
  const carousel = (over: Record<string, unknown> = {}) => ({
    platform: 'instagram', platforms: ['instagram'], format: 'carousel', media: 'image',
    day: 'Monday', time: '09:00', product: '', person: '', angle: 'a', subject: 's', setting: '', props: '',
    ...over
  });

  it('sopravvive al round-trip', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [
      carousel({ sourced_from: 'racconto su r/italyinformatica del 12/03 — https://example.org/post' })
    ] });
    expect(out.seeds[0].sourced_from).toBe('racconto su r/italyinformatica del 12/03 — https://example.org/post');
  });

  it('non inventa una fonte quando non ce n\'è', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [carousel()] });
    expect(out.seeds[0].sourced_from).toBeUndefined();
  });
});

// Il tetto ai caroselli era 1 per batch, un numero d'ambiente che nessuno aveva scelto guardando
// niente. Era anche la ragione per cui la rubrica narrativa usciva una volta ogni tanto: con il
// budget come vincolo vero, il tetto non deve più fare la scelta editoriale al posto dell'agente.
describe('carouselMaxPerBatch', () => {
  it('di default non decide più il mix', () => {
    expect(carouselMaxPerBatch()).toBeGreaterThan(1);
  });

  it('resta un freno d\'emergenza da variabile d\'ambiente', () => {
    expect(typeof carouselMaxPerBatch()).toBe('number');
  });
});

// Un batch che copre due settimane ha bisogno che ogni post sappia in quale delle due sta: il seed
// portava solo il giorno della settimana, quindi tutto sarebbe finito nella prima.
describe('la settimana del seed', () => {
  const s = (over: Record<string, unknown> = {}) => ({
    platform: 'instagram', platforms: ['instagram'], format: 'single_image', media: 'image',
    day: 'Monday', time: '09:00', product: '', person: '', angle: 'a', subject: '', setting: '', props: '',
    ...over
  });

  it('sopravvive al round-trip', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [s({ week: 2 })] });
    expect(out.seeds[0].week).toBe(2);
  });

  it('la settimana zero non si perde per strada', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [s({ week: 0 })] });
    expect(out.seeds[0].week).toBe(0);
  });

  it('senza settimana resta indefinita invece di diventare la prima', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [s()] });
    expect(out.seeds[0].week).toBeUndefined();
  });

  it('una settimana non numerica si scarta', () => {
    const out = normalizeWeeklyStrategy({ theme: 't', rationale: 'r', do_dont: '', seeds: [s({ week: 'lunedì' })] });
    expect(out.seeds[0].week).toBeUndefined();
  });
});
