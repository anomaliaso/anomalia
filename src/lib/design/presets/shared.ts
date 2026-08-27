/**
 * Shared vocabulary for the style presets.
 *
 * Layout helpers, the canvas, the demo copy — everything the presets have in common and nothing
 * about how any of them LOOKS. What a preset is and why the library has no storage is documented
 * in ./index.ts; what makes each one different lives in its own file.
 *
 * The trees are plain objects in satori's shape (same convention as graphic-tree.ts), so this
 * module imports nothing and can be read from a route, a job or the browser.
 */

export const PRESET_WIDTH = 1080;
/** 3:4 — the tallest crop Instagram keeps intact in the feed. */
export const PRESET_HEIGHT = 1440;

/** 9:16 — Stories / Reels / TikTok. Same width as the post canvas so `s()` stays valid. */
export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;

export const STORY_VARIANTS = ['a', 'b', 'c'] as const;
export type StoryVariant = (typeof STORY_VARIANTS)[number];

export function isStoryVariant(v: unknown): v is StoryVariant {
  return typeof v === 'string' && (STORY_VARIANTS as readonly string[]).includes(v);
}

/** Canvas-relative sizing: `s(8.4)` is "8.4% of the canvas width". Mirrors blocks.ts `scale`. */
export const s = (pct: number) => Math.round((PRESET_WIDTH * pct) / 100);

/**
 * The slides, in carousel order.
 *
 * Order is the product, not a list: a carousel opens on a claim, earns trust in the middle and
 * asks for something at the end. A preset renders all eight, so a brand that picks one gets a
 * complete week rather than a cover and five improvisations.
 */
export const PRESET_SLIDES = [
  'cover',
  'fotopiena',
  'citazione',
  'lista',
  'confronto',
  'fotoparziale',
  'numero',
  'cta'
] as const;
export type PresetSlide = (typeof PRESET_SLIDES)[number];

export function isPresetSlide(v: unknown): v is PresetSlide {
  return typeof v === 'string' && (PRESET_SLIDES as readonly string[]).includes(v);
}

/** The slide's place in the carousel, for presets that print an index. */
export const slideIndex = (kind: PresetSlide) =>
  `${String(PRESET_SLIDES.indexOf(kind) + 1).padStart(2, '0')}/${String(PRESET_SLIDES.length).padStart(2, '0')}`;

/**
 * Three demo photographs, as data URIs. Every preset gets all three even when it only shows one:
 * the fetch is local and the render is CDN-cached, so gating it per slide bought nothing and broke
 * the moment a preset (Vetrina) wanted an image on every slide.
 */
export type PresetPhotos = { a: string; b: string; c: string };

// ---------------------------------------------------------------- satori tree helpers
type Style = Record<string, unknown>;
export type El = {
  type: string;
  props: { style: Style; children?: El | El[] | string; src?: string; width?: number; height?: number };
};

export const el = (
  style: Style,
  children?: El | El[] | string,
  type = 'div',
  extra: Partial<El['props']> = {}
): El => ({ type, props: { style, children, ...extra } });

export const col = (style: Style, children?: El | El[] | string) =>
  el({ display: 'flex', flexDirection: 'column', ...style }, children);

export const row = (style: Style, children?: El | El[] | string) =>
  el({ display: 'flex', flexDirection: 'row', ...style }, children);

/** Satori has no <br>: an explicit newline becomes its own line box. Same rule as graphic-tree.ts. */
export const lines = (text: string, style: Style): El[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => el({ display: 'flex', ...style }, l));

/** The one positioning primitive: "push what follows away". */
export const grow = (n = 1) => el({ display: 'flex', flexGrow: n }, '');
export const gap = (pct: number) => el({ display: 'flex', height: s(pct) }, '');

export const img = (src: string, w: number, h: number, extra: Style = {}) =>
  el({ display: 'flex', width: w, height: h, objectFit: 'cover', ...extra }, undefined, 'img', {
    src,
    width: w,
    height: h
  });

/** Full-bleed photo + veil + stack on top. Size defaults to the 3:4 post canvas. */
export const fullBleed = (
  src: string,
  veil: string,
  content: El,
  bg: string,
  size: { width: number; height: number } = { width: PRESET_WIDTH, height: PRESET_HEIGHT }
): El =>
  el(
    {
      display: 'flex',
      position: 'relative',
      width: size.width,
      height: size.height,
      backgroundColor: bg,
      overflow: 'hidden'
    },
    [
      img(src, size.width, size.height, { position: 'absolute', top: 0, left: 0 }),
      el(
        {
          display: 'flex',
          position: 'absolute',
          top: 0,
          left: 0,
          width: size.width,
          height: size.height,
          ...(veil.startsWith('linear-gradient') ? { backgroundImage: veil } : { backgroundColor: veil })
        },
        ''
      ),
      content
    ]
  );

// ---------------------------------------------------------------- demo copy
/**
 * The words shown in the library. Placeholder on purpose — a visitor is choosing a layout, and real
 * copy about a real brand pulls attention onto the sentence instead of onto the form.
 */
export const DEMO = {
  cover: {
    kicker: 'Point of view',
    headline: 'Most content\nnever gets\nread',
    sub: 'And almost always the reason is not the writing. It is that nobody stopped.'
  },
  fotopiena: {
    kicker: 'The point',
    headline: 'It is not\nhow much you post',
    sub: 'It is how much of what you post actually looks like you.'
  },
  citazione: {
    kicker: 'What they say',
    quote: 'I stopped waking up on Sunday to publish. That was the only metric I cared about.',
    author: 'Chiara M.',
    role: 'owner, neighbourhood shop'
  },
  lista: {
    kicker: 'How it works',
    headline: 'Three steps\nto stop\nimprovising',
    items: ['Pick one thing to say', 'Say it in the first three seconds', 'Repeat it for a month']
  },
  confronto: {
    kicker: 'The comparison',
    headline: 'Two ways\nto spend\nthe week',
    a: { label: 'Before', items: ['Three hours every Sunday', 'Last-minute ideas', 'A whole month with no posts'] },
    b: { label: 'After', items: ['Twenty minutes on Monday', 'A plan already written', 'No gaps in the calendar'] }
  },
  fotoparziale: {
    kicker: 'Before and after',
    headline: 'The difference\nshows in half\na second',
    sub: 'Same company, same product, same budget. Only the form changes.',
    caption: 'the same scene, treated two ways'
  },
  numero: {
    kicker: 'The number',
    stat: '78%',
    label: 'of people decide whether to stay\nin the first three seconds',
    sub: 'Everything you write after that is only read by people who already stayed.'
  },
  cta: {
    kicker: 'The end',
    headline: 'The rest\nis here',
    sub: 'Three quick things, then back to scrolling.',
    handle: '@yourbrand',
    actions: ['Follow for the next one', 'Save this carousel', 'Drop a comment']
  }
} as const;

/** Where the brand's own name, site and mark will land once a preset is attached to a brand. */
export const BRAND_SLOT = 'Your brand';
export const SITE_SLOT = 'your-site.com';

// ---------------------------------------------------------------- the preset shape
export type PresetFonts = { display: string; body: string; mono: string };

export type Bilingual = { it: string; en: string };

export type PresetBuild = (fonts: PresetFonts, photos: PresetPhotos) => El;

/** Serialisable tokens for the Remotion StyleReel (no functions, no trees). */
export type PresetReelTokens = {
  bg: string;
  ink: string;
  accent: string;
  muted: string;
  displayFont: string;
  bodyFont: string;
};

export type StylePreset = {
  slug: string;
  name: string;
  /** One line on what the preset actually is. */
  thesis: Bilingual;
  /** Who it suits — the question a visitor is really asking. */
  suits: Bilingual;
  fonts: PresetFonts;
  /** Shown as a spec table on the detail page. */
  spec: ReadonlyArray<{ label: Bilingual; value: Bilingual }>;
  /** Carousel 3:4 — eight distinct compositions. */
  build: (kind: PresetSlide, fonts: PresetFonts, photos: PresetPhotos) => El;
  /**
   * Three 9:16 story layouts. Same palette/voice as the carousel; each variant is a different
   * composition (not a crop of the 3:4 slides).
   */
  stories: Record<StoryVariant, PresetBuild>;
  /** Colour + font tokens for the animated Remotion reel. */
  reel: PresetReelTokens;
};
