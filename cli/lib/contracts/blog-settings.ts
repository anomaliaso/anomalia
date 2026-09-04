import { z } from 'zod';
import type { BrandEndpoint } from './index';

export const BLOG_FONTS = ['sans', 'serif', 'rounded', 'mono'] as const;
export const BLOG_LAYOUTS = ['navbar', 'sidebar'] as const;

/**
 * I tre elenchi del blog che un brand puo' comporre. `category` e `author` sono riferimenti che un
 * articolo tiene (`category_id`, `author_id`); `tag` e' una relazione molti-a-molti. La differenza
 * conta solo quando si cancella, ed e' scritta nella descrizione di `remove_blog_term`.
 */
export const BLOG_TERM_KINDS = ['category', 'tag', 'author'] as const;
export type BlogTermKind = (typeof BLOG_TERM_KINDS)[number];

const term = z.enum(BLOG_TERM_KINDS).describe('Which list the entry belongs to');

/**
 * Gli unici script di terze parti che il blog di un brand puo' caricare. E' un elenco CHIUSO, e la
 * chiusura e' il punto: un campo `<script>` libero sarebbe esecuzione di codice arbitrario sulle
 * pagine del cliente, e su `/blog/<slug>` — che sta sulla nostra origine, insieme alla sessione di
 * chi e' loggato in `/app` — sarebbe una presa di controllo dell'account.
 *
 * Ogni id finisce dentro lo snippet del fornitore, quindi il pattern non e' una validazione di
 * comodo: e' cio' che impedisce a una virgoletta o a un `<` di uscire dal contesto previsto.
 */
export const BLOG_ANALYTICS_ID_PATTERNS = {
  ga4: /^G-[A-Z0-9]{4,20}$/,
  meta_pixel: /^[0-9]{6,20}$/,
  plausible: /^[a-z0-9][a-z0-9.-]{1,78}[a-z0-9]$/,
  hotjar: /^[0-9]{5,12}$/
} as const;

export const BLOG_ANALYTICS_PROVIDERS = Object.keys(
  BLOG_ANALYTICS_ID_PATTERNS
) as unknown as readonly BlogAnalyticsProvider[];

export type BlogAnalyticsProvider = keyof typeof BLOG_ANALYTICS_ID_PATTERNS;

export function blogAnalyticsIdOk(provider: string, id: string): boolean {
  const pattern = BLOG_ANALYTICS_ID_PATTERNS[provider as BlogAnalyticsProvider];
  return pattern !== undefined && pattern.test(id);
}

const AnalyticsEntry = z
  .object({
    provider: z.enum(Object.keys(BLOG_ANALYTICS_ID_PATTERNS) as [BlogAnalyticsProvider, ...BlogAnalyticsProvider[]]),
    id: z.string().min(1).describe('Measurement id: G-XXXXXXX (ga4), numeric (meta_pixel, hotjar), domain (plausible)')
  })
  .strict()
  .refine((e) => blogAnalyticsIdOk(e.provider, e.id), {
    message: 'id does not match the shape that provider issues'
  });

const NavbarLink = z.object({ label: z.string(), url: z.string() });

const BlogConfig = z.object({
  enabled: z.boolean(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  accent: z.string(),
  font: z.string(),
  layout: z.string(),
  show_blog_link: z.boolean(),
  humanizer_enabled: z.boolean(),
  backlink_network: z.boolean(),
  style_instructions: z.string().nullable(),
  articles_per_week: z.number().nullable(),
  default_locale: z.string().nullable(),
  locales: z.array(z.string()),
  navbar_links: z.array(NavbarLink),
  icon_url: z.string().nullable(),
  analytics: z.array(z.object({ provider: z.string(), id: z.string() }))
});

export const GET_BLOG_SETTINGS = {
  tool: 'get_blog_settings',
  title: 'Blog settings',
  description:
    'How the brand’s blog looks and how it writes: the public site’s name, colour, font and ' +
    'layout, the style brief the AI follows, how many articles a week it produces, the ' +
    'languages, and the categories, tags and authors an article can be filed under. Read it ' +
    'before set_blog_settings and before add_blog_term — it carries the fonts, layouts and ' +
    'locales that are accepted, and the plan’s ceiling on articles per week and on extra ' +
    'languages.',
  method: 'GET',
  pathUnderBrand: '/settings/blog',
  input: z.object({}).strict(),
  output: z.object({
    brand: z.string(),
    plan: z.string().nullable(),
    config: BlogConfig,
    limits: z.object({
      articles_per_week_max: z.number(),
      translation_languages: z.number(),
      custom_domain: z.boolean()
    }),
    choices: z.object({
      fonts: z.array(z.string()),
      layouts: z.array(z.string()),
      locales: z.array(z.string())
    }),
    categories: z.array(
      z.object({ id: z.string(), name: z.string(), slug: z.string(), description: z.string().nullable() })
    ),
    tags: z.array(z.object({ id: z.string(), name: z.string(), slug: z.string() })),
    authors: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        role: z.string().nullable(),
        bio: z.string().nullable(),
        avatar_url: z.string().nullable()
      })
    )
  }),
  failures: [],
  destructive: false
} satisfies BrandEndpoint;

export const SET_BLOG_SETTINGS = {
  tool: 'set_blog_settings',
  title: 'Change the blog settings',
  description:
    'Change how the blog looks and how it writes. Only the fields you send change; every other ' +
    'one keeps its value. `articles_per_week` is CLAMPED to the plan’s ceiling rather than ' +
    'refused, and the answer says what was actually saved — read it back instead of assuming ' +
    'your number was taken. `locales`, `navbar_links` and `analytics` replace their whole list. ' +
    'Turning `enabled` off takes the public blog down; it deletes no article. The blog icon and an ' +
    'author’s avatar are images and cannot be set here. `analytics` takes a CLOSED list of ' +
    'providers with their measurement id — there is no field for arbitrary JavaScript, and asking ' +
    'for one is refused: a script tag here would run on every visitor’s page. Those trackers load ' +
    'ONLY on a verified custom domain and ONLY after the visitor accepts cookies; on the default ' +
    '/blog/<slug> address they are stored and never emitted, because that address is Anomalia’s ' +
    'own origin. Calls no model and spends no credits.',
  method: 'PUT',
  pathUnderBrand: '/settings/blog',
  input: z
    .object({
      enabled: z.boolean().optional().describe('Whether the public blog is live'),
      title: z.string().nullable().optional().describe('Site name, 80 chars; null falls back to the brand name'),
      description: z.string().nullable().optional().describe('Site description, 300 chars'),
      accent: z.string().optional().describe('Six-digit hex, e.g. "#7c5cff"'),
      font: z.enum(BLOG_FONTS).optional(),
      layout: z.enum(BLOG_LAYOUTS).optional(),
      show_blog_link: z.boolean().optional().describe('Show the Blog link in the main site nav'),
      humanizer_enabled: z.boolean().optional().describe('Run the humanising pass over generated articles'),
      backlink_network: z.boolean().optional().describe('Take part in the cross-brand backlink network'),
      style_instructions: z
        .string()
        .nullable()
        .optional()
        .describe('Free-text brief the article generator follows, 1500 chars'),
      articles_per_week: z
        .number()
        .nullable()
        .optional()
        .describe('Cadence; clamped to the plan ceiling. null returns to the plan default'),
      default_locale: z
        .string()
        .nullable()
        .optional()
        .describe('Language the bare blog URL lands on, from choices.locales'),
      locales: z
        .array(z.string())
        .optional()
        .describe('Extra languages articles are translated into. Replaces the whole list'),
      navbar_links: z.array(NavbarLink).optional().describe('Up to 6 custom nav links. Replaces the whole list'),
      analytics: z
        .array(AnalyticsEntry)
        .max(4)
        .optional()
        .describe(
          'Third-party analytics, one entry per provider. Replaces the whole list; [] removes them all, ' +
            'which is how a tracker is taken off a live site without us'
        )
    })
    .strict(),
  output: z.object({ ok: z.literal(true), config: BlogConfig }),
  failures: [
    { error: 'no_fields', status: 400 },
    { error: 'unknown_locale', status: 400 },
    { error: 'update_failed', status: 500 }
  ],
  destructive: false
} satisfies BrandEndpoint;

export const ADD_BLOG_TERM = {
  tool: 'add_blog_term',
  title: 'Add a blog category, tag or author',
  description:
    'Create one entry an article can be filed under. The URL slug is derived from the name and ' +
    'must be unique for the brand: a name that slugs to one already there answers ' +
    'slug_taken rather than creating a second. `description` belongs to a category; `bio` and ' +
    '`role` to an author; a tag takes only a name. An author’s avatar is an image and cannot be ' +
    'set here — the author is created without one.',
  method: 'POST',
  pathUnderBrand: '/settings/blog/terms',
  input: z
    .object({
      term,
      name: z.string().min(1).describe('What it is called; the slug is derived from it'),
      description: z.string().optional().describe('Category only, 300 chars'),
      bio: z.string().optional().describe('Author only, 500 chars'),
      role: z.string().optional().describe('Author only, e.g. "writer" or "editor", 30 chars')
    })
    .strict(),
  output: z.object({
    ok: z.literal(true),
    term: z.enum(BLOG_TERM_KINDS),
    id: z.string(),
    name: z.string(),
    slug: z.string()
  }),
  failures: [
    { error: 'field_not_for_term', status: 400 },
    { error: 'empty_slug', status: 400 },
    { error: 'slug_taken', status: 409 },
    { error: 'insert_failed', status: 500 }
  ],
  destructive: false
} satisfies BrandEndpoint;

export const REMOVE_BLOG_TERM = {
  tool: 'remove_blog_term',
  title: 'Remove a blog category, tag or author',
  description:
    'Delete one entry. No article is deleted, but each kind leaves a different mark, so say ' +
    'which before you do it: removing a CATEGORY leaves its articles filed under nothing; ' +
    'removing a TAG takes that tag off every article that carried it; removing an AUTHOR clears ' +
    'the byline on their articles. It does not come back, and the articles keep no record of ' +
    'what was removed.',
  method: 'POST',
  pathUnderBrand: '/settings/blog/terms/remove',
  input: z.object({ term, id: z.string().min(1).describe('Row id, verbatim from get_blog_settings') }).strict(),
  output: z.object({
    ok: z.literal(true),
    term: z.enum(BLOG_TERM_KINDS),
    id: z.string(),
    /** Quanti articoli restano senza quella voce: la conseguenza, contata, non promessa. */
    articles_affected: z.number()
  }),
  failures: [
    { error: 'not_found', status: 404 },
    { error: 'delete_failed', status: 500 }
  ],
  destructive: true
} satisfies BrandEndpoint;
