/**
 * The public wall's shared vocabulary — the half that has to exist on BOTH sides.
 *
 * `$lib/server/wall.ts` reads the database and is server-only by SvelteKit's own rule; the pages and
 * the card component need the same tag list, the same platform list and the same card shape to
 * render it. Duplicating either list would mean a filter chip that silently matches nothing the day
 * one of the two drifts, so the vocabulary lives here and the server module imports it — the same
 * split `composio-catalog.ts` uses.
 *
 * Nothing in this file touches the network, the database or `$env/dynamic/private`, which is what
 * makes it safe to pull into a `.svelte` file.
 */

/**
 * The look, as a FIXED vocabulary — fixed because these are the filters the public page groups on,
 * and a free-form label produces exactly one bucket per post and therefore no filter at all.
 *
 * Chosen to describe how a piece is MADE rather than what it advertises: the harvest's `category`
 * already carries the vertical, and a design wall that sorts by industry is a directory, not a wall.
 *
 * Every id here needs a `wall.tags.<id>` string in all four locale catalogues.
 */
export const DESIGN_TAGS = [
  'minimal',
  'brutalist',
  'editorial',
  'type_driven',
  'gradient',
  'monochrome',
  'high_contrast',
  'photographic',
  'illustration',
  '3d',
  'motion',
  'ui_screenshot',
  'data_viz',
  'retro',
  'maximalist',
  'collage',
  'hand_made'
] as const;
export type DesignTag = (typeof DESIGN_TAGS)[number];

/** The axes the overall score is built from. Rendered on the detail page, one bar each. */
export const DESIGN_AXES = ['typography', 'composition', 'colour', 'craft', 'originality'] as const;
export type DesignAxis = (typeof DESIGN_AXES)[number];

/** The platforms either page will show a filter chip for. */
export const WALL_PLATFORMS = ['instagram', 'tiktok', 'x', 'threads', 'linkedin', 'reddit'] as const;
export type WallPlatform = (typeof WALL_PLATFORMS)[number];

/**
 * What a page is allowed to know about a post.
 *
 * This type IS the whitelist: `toCard` in the server module builds it field by field, so a column
 * added to `market_posts` cannot reach a template without being added here on purpose.
 */
export type WallCard = {
  /** The public identity. Never the row's uuid — that is an internal handle. */
  slug: string;
  platform: string;
  /** Handle / subreddit / author name, exactly as the platform reported it. */
  account: string | null;
  /** The original post. The link out is the attribution, so a card without one is not shown. */
  sourceUrl: string;
  caption: string | null;
  publishedAt: string | null;

  posterUrl: string;
  /** The animated preview, when the source was a clip. Null means "this was always a still". */
  previewUrl: string | null;

  /** Our commentary, already in the visitor's language. */
  note: string | null;
  designScore: number | null;
  designScores: Record<DesignAxis, number> | null;
  tags: DesignTag[];

  /** Why it is on the trending page: how far past its own account's median it went. */
  outperformance: number | null;
  views: number | null;
  engagement: number | null;
  category: string | null;
  contentForm: string | null;
};
