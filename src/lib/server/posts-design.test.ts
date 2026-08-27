import { describe, expect, it } from 'vitest';
import {
  mergeCards,
  parseDetail,
  parseGalleryCards,
  parseStem,
  parseSitemap,
  publishedAtFromSlug,
  queryTerms,
  rankIndex,
  type PostsDesignIndexEntry
} from './posts-design';

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
<url><loc>https://posts.design/about</loc><lastmod>2026-08-19</lastmod></url>
<url>
<loc>https://posts.design/cerebras-the-fastest-ai-just-got-faster-2026-08-19</loc>
<image:image><image:loc>https://posts.design/images/posts/x-twitter-cerebras-2089870131291943228-cerebras-fastest-ai-got-faster.webp</image:loc></image:image>
<lastmod>2026-08-19</lastmod>
</url>
<url>
<loc>https://posts.design/we-re-continuing-to-improve-cloud-agents-in-2026-08-19</loc>
<image:image><image:loc>https://posts.design/images/posts/x-twitter-cursor-ai-2090136956101414982-continuing-improve-cloud-agents-cursor.webp</image:loc></image:image>
<lastmod>2026-08-19</lastmod>
</url>
</urlset>`;

const GALLERY = `<article data-item-id="x-twitter-cerebras-2089870131291943228-cerebras-fastest-ai-got-faster" class="wall-card">
<a href="/cerebras-the-fastest-ai-just-got-faster-2026-08-19"><figure>
<img data-video-placeholder="true" src="/images/posts/x-twitter-cerebras-2089870131291943228-cerebras-fastest-ai-got-faster.webp"/>
<figcaption class="sr-only">Cerebras: The Fastest AI Just Got Faster · Cerebras · @cerebras · Product Update · Announcement Card<!-- -->. Captured <!-- -->2026-08-19<!-- -->. Original source attached on the reference page.</figcaption>
</figure></a></article>
<article data-item-id="x-twitter-felixhhaas-2090108713336295433-felix-haas-design-systems-lovable" class="wall-card">
<a href="/felix-haas-design-systems-in-lovable-2026-08-19"><figure>
<img src="/images/posts/x-twitter-felixhhaas-2090108713336295433-felix-haas-design-systems-lovable.webp"/>
<figcaption class="sr-only">Felix Haas: Design Systems in Lovable · Felixhhaas · @felixhhaas · Launch · Product Screenshot, Soft UI<!-- -->. Captured <!-- -->2026-08-19<!-- -->.</figcaption>
</figure></a></article>`;

const DETAIL = `<head>
<meta name="description" content="How Cerebras designed its product update post: announcement card, minimal. The Fastest AI Just Got Faster."/>
<meta property="og:title" content="Cerebras: The Fastest AI Just Got Faster - posts.design"/>
</head><body>
<figcaption class="theme-faint">What the post said</figcaption><blockquote class="theme-subtle">The Fastest AI Just Got Faster. Meet CS-4.</blockquote>
<video src="/media/posts/x-twitter-cerebras-2089870131291943228-cerebras-fastest-ai-got-faster-detail.mp4"></video>
<img src="/images/posts/x-twitter-cerebras-2089870131291943228-cerebras-fastest-ai-got-faster.webp"/>
<a href="https://x.com/cerebras/status/2089870131291943228">see original</a>
<a href="https://x.com/baseddesigner">Curated by @baseddesigner</a>
<article data-item-id="x-twitter-etched-2089729087732605282-etched-weve-raised-700m-21b-valuation">
<video src="/media/posts/x-twitter-etched-2089729087732605282-etched-weve-raised-700m-21b-valuation-detail.mp4"></video>
<a href="https://x.com/etched/status/2089729087732605282">original</a>
</article></body>`;

describe('parseStem', () => {
  it('splits platform, handle, post id and words', () => {
    expect(parseStem('x-twitter-cerebras-2089870131291943228-cerebras-fastest-ai-got-faster')).toEqual({
      platform: 'x-twitter',
      handleSlug: 'cerebras',
      externalId: '2089870131291943228',
      words: 'cerebras fastest ai got faster'
    });
  });

  it('keeps a dashed handle whole', () => {
    expect(parseStem('x-twitter-cursor-ai-2090136956101414982-continuing-improve-cloud-agents')?.handleSlug).toBe(
      'cursor-ai'
    );
  });

  it('is null for a stem without a post id', () => {
    expect(parseStem('some-random-file-name')).toBeNull();
  });
});

describe('parseSitemap', () => {
  it('keeps only post URLs and derives the source fields', () => {
    const entries = parseSitemap(SITEMAP);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: 'x-twitter-cerebras-2089870131291943228-cerebras-fastest-ai-got-faster',
      slug: 'cerebras-the-fastest-ai-just-got-faster-2026-08-19',
      url: 'https://posts.design/cerebras-the-fastest-ai-just-got-faster-2026-08-19',
      platform: 'x-twitter',
      handleSlug: 'cerebras',
      externalId: '2089870131291943228',
      capturedAt: '2026-08-19'
    });
  });

  it('drops pages with no post media (about, trends, brands)', () => {
    expect(parseSitemap(SITEMAP).some((e) => e.slug === 'about')).toBe(false);
  });
});

describe('parseGalleryCards', () => {
  it('reads the taxonomy out of the screen-reader caption', () => {
    const cards = parseGalleryCards(GALLERY);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      title: 'Cerebras: The Fastest AI Just Got Faster',
      brand: 'Cerebras',
      handle: 'cerebras',
      category: 'product update',
      hasVideo: true,
      slug: 'cerebras-the-fastest-ai-just-got-faster-2026-08-19'
    });
    expect(cards[0].styleTags).toEqual(['announcement card']);
  });

  it('splits multi-tag styles and marks a still as not video', () => {
    const felix = parseGalleryCards(GALLERY)[1];
    expect(felix.styleTags).toEqual(['product screenshot', 'soft ui']);
    expect(felix.hasVideo).toBe(false);
  });

  it('never reads a caption off the neighbouring card', () => {
    const cards = parseGalleryCards(GALLERY);
    expect(cards[1].brand).toBe('Felixhhaas');
  });
});

describe('parseDetail', () => {
  const entry: PostsDesignIndexEntry = parseSitemap(SITEMAP)[0];

  it('reads brand, category, style tags and the quoted copy', () => {
    const d = parseDetail(DETAIL, entry);
    expect(d.brand).toBe('Cerebras');
    expect(d.category).toBe('product update');
    expect(d.styleTags).toEqual(['announcement card', 'minimal']);
    // The page quotes the post in full; the meta description truncates it.
    expect(d.text).toBe('The Fastest AI Just Got Faster. Meet CS-4.');
    expect(d.title).toBe('Cerebras: The Fastest AI Just Got Faster');
  });

  it('takes the clip and the original link of THIS post, not of a similar one', () => {
    const d = parseDetail(DETAIL, entry);
    expect(d.videoUrl).toContain('cerebras-fastest-ai-got-faster-detail.mp4');
    expect(d.videoUrl).not.toContain('etched');
    expect(d.sourceUrl).toBe('https://x.com/cerebras/status/2089870131291943228');
    expect(d.hasVideo).toBe(true);
  });

  it('degrades to nulls rather than guessing when the template changes', () => {
    const d = parseDetail('<head></head><body>nothing here</body>', entry);
    expect(d.brand).toBeNull();
    expect(d.category).toBeNull();
    expect(d.videoUrl).toBeNull();
    expect(d.hasVideo).toBe(false);
    expect(d.id).toBe(entry.id);
  });
});

describe('publishedAtFromSlug', () => {
  it('reads the trailing date', () => {
    expect(publishedAtFromSlug('nothing-updating-2026-08-18')).toBe('2026-08-18');
    expect(publishedAtFromSlug('about')).toBeNull();
  });
});

describe('queryTerms', () => {
  it('drops stop words and words that match everything', () => {
    expect(queryTerms('a video post for the launch of an AI product')).toEqual(['launch', 'product']);
  });

  it('strips the @ off a handle', () => {
    expect(queryTerms('like @cerebras')).toEqual(['cerebras']);
  });
});

describe('rankIndex', () => {
  const entries = parseSitemap(SITEMAP);

  it('puts the matching post first', () => {
    expect(rankIndex(entries, 'cerebras faster', 1)[0].handleSlug).toBe('cerebras');
    expect(rankIndex(entries, 'cursor cloud agents', 1)[0].handleSlug).toBe('cursor-ai');
  });

  it('still returns candidates when nothing matches — the agent has to have something to watch', () => {
    expect(rankIndex(entries, 'zzz nothing at all like this', 2)).toHaveLength(2);
  });

  it('matches on the taxonomy once a card has been merged in', () => {
    const merged = mergeCards(entries, parseGalleryCards(GALLERY));
    const top = rankIndex(merged, 'announcement card', 1)[0];
    expect(top.id).toContain('cerebras');
  });
});

describe('mergeCards', () => {
  it('enriches the index in place and keeps a card the sitemap has not caught up with', () => {
    const merged = mergeCards(parseSitemap(SITEMAP), parseGalleryCards(GALLERY));
    expect(merged).toHaveLength(3);
    const cerebras = merged.find((e) => e.id.includes('cerebras'))!;
    expect((cerebras as { category?: string }).category).toBe('product update');
    expect(merged[0].id).toContain('felixhhaas');
  });
});

describe('rankIndex when nothing matches', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: `p${i}`,
    slug: `p${i}`,
    url: `https://posts.design/p${i}`,
    handleSlug: `h${i}`,
    externalId: `${i}`,
    words: `english words number ${i}`,
    capturedAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`
  })) as PostsDesignIndexEntry[];

  it('does not hand every brief the same top of the wall', () => {
    const a = rankIndex(many, 'un lancio prodotto per una gelateria artigianale', 5).map((e) => e.id);
    const b = rankIndex(many, 'teaser per una palestra di quartiere', 5).map((e) => e.id);
    expect(a).not.toEqual(b);
  });

  it('is stable for the same brief', () => {
    const q = 'un lancio prodotto per una gelateria artigianale';
    expect(rankIndex(many, q, 5)).toEqual(rankIndex(many, q, 5));
  });
});
