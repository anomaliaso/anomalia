/**
 * OGNI VINCOLO, PROVATO CON UN INSERT CHE DEVE FALLIRE.
 *
 * Un CHECK dichiarato in una migration e mai provato è una speranza: la suite mocka Supabase,
 * un insert finto accetta qualunque stringa, e il vincolo resta verde per costruzione (LESSONS.md,
 * «Un valore che il CHECK rifiuta è invisibile a una suite che mocka il database»). Qui il
 * database è vero: ogni caso scrive davvero, e il caso passa SOLO se Postgres lo rifiuta con lo
 * SQLSTATE atteso.
 *
 *   23514  check_violation      il CHECK ha morso
 *   23502  not_null_violation   il NOT NULL ha morso
 *
 * Si guarda fallire PRIMA della migration (ogni caso «accettato» = vincolo assente) e passare
 * dopo. Tutto gira dentro UNA transazione chiusa da un ROLLBACK: non resta una riga.
 *
 *   DATABASE_URL=postgres://postgres:<pw>@127.0.0.1:5432/postgres node scripts/constraint-harness.mjs
 *   npm run test:constraints
 *
 * DATABASE_URL deve puntare a localhost: contro un database remoto lo script si rifiuta di partire.
 *
 * ponytail: i casi sono dati, non codice — una riga per vincolo, nessuna astrazione per tabella.
 * Il ceiling è che i valori validi non sono provati (solo quelli rifiutati): il giorno in cui un
 * vincolo si rivelasse troppo stretto in produzione, il caso «deve passare» si aggiunge qui.
 */
import { Client } from 'pg';

const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

const post = (columns, values) => `insert into public.posts (brand_id, ${columns}) values ($1, ${values})`;
const product = (columns, values) => `insert into public.products (brand_id, title, ${columns}) values ($1, 'ok', ${values})`;
const kit = (column, value) => `insert into public.brand_kit (brand_id, ${column}) values ($1, ${value})`;
const article = (columns, values) =>
  `insert into public.brand_articles (brand_id, slug, title, body_md, ${columns}) values ($1, 'ok', 'ok', 'ok', ${values})`;
const plan = (columns, values) => `insert into public.content_plans (brand_id, ${columns}) values ($1, ${values})`;
const person = (columns, values) => `insert into public.people (brand_id, name, kind, ${columns}) values ($1, 'ok', 'real', ${values})`;
const competitor = (columns, values) => `insert into public.competitors (brand_id, name, ${columns}) values ($1, 'ok', ${values})`;
const memory = (columns, values) =>
  `insert into public.brand_memory (brand_id, category, key, value, ${columns}) values ($1, 'fact', 'k', 'v', ${values})`;
const site = (value) => `insert into public.brand_sites (brand_id, host) values ($1, ${value})`;
const newsSource = (columns, values) => `insert into public.brand_news_sources (brand_id, kind, ${columns}) values ($1, 'rss', ${values})`;

const CASES = [
  { what: 'posts.status fuori vocabolario', sql: post('status', `'nope'`), code: CHECK_VIOLATION },
  { what: 'posts.content_type con un formato al posto di un tipo', sql: post('content_type', `'carousel'`), code: CHECK_VIOLATION },
  { what: 'posts.source fuori vocabolario', sql: post('source', `'nope'`), code: CHECK_VIOLATION },
  { what: 'posts.video_render_status fuori vocabolario', sql: post('video_render_status', `'nope'`), code: CHECK_VIOLATION },
  { what: 'posts.video_resolution fuori vocabolario', sql: post('video_resolution', `'4k'`), code: CHECK_VIOLATION },
  { what: 'posts.video_duration_seconds a zero', sql: post('video_duration_seconds', '0'), code: CHECK_VIOLATION },
  { what: 'posts.video_duration_seconds oltre un ora', sql: post('video_duration_seconds', '3601'), code: CHECK_VIOLATION },
  { what: 'posts.revisions_count negativo', sql: post('revisions_count', '-1'), code: CHECK_VIOLATION },
  { what: 'posts.media_url non http', sql: post('media_url', `'ftp://x'`), code: CHECK_VIOLATION },
  { what: 'posts.media_urls non array', sql: post('media_urls', `'"x"'::jsonb`), code: CHECK_VIOLATION },
  { what: 'posts.caption oltre il tetto', sql: post('caption', `repeat('x', 10001)`), code: CHECK_VIOLATION },
  { what: 'posts.slot oltre il tetto', sql: post('slot', `repeat('x', 101)`), code: CHECK_VIOLATION },

  { what: 'products.title vuoto', sql: `insert into public.products (brand_id, title) values ($1, '   ')`, code: CHECK_VIOLATION },
  { what: 'products.title oltre il tetto', sql: `insert into public.products (brand_id, title) values ($1, repeat('x', 501))`, code: CHECK_VIOLATION },
  { what: 'products.url non http', sql: product('url', `'nope'`), code: CHECK_VIOLATION },
  { what: 'products.images non array', sql: product('images', `'{}'::jsonb`), code: CHECK_VIOLATION },
  { what: 'products.kind oltre il tetto', sql: product('kind', `repeat('x', 201)`), code: CHECK_VIOLATION },
  { what: 'products.description oltre il tetto', sql: product('description', `repeat('x', 50001)`), code: CHECK_VIOLATION },

  { what: 'brand_kit.favicon_url non http ne data', sql: kit('favicon_url', `'nope'`), code: CHECK_VIOLATION },
  { what: 'brand_kit.source_url e un handle, non un sito', sql: kit('source_url', `'Mariopuggelli1939'`), code: CHECK_VIOLATION },
  { what: 'brand_kit.theme_color e un colore CSS, non hex', sql: kit('theme_color', `'red'`), code: CHECK_VIOLATION },
  { what: 'brand_kit.site_type fuori vocabolario', sql: kit('site_type', `'nope'`), code: CHECK_VIOLATION },
  { what: 'brand_kit.brand_colors non array', sql: kit('brand_colors', `'{}'::jsonb`), code: CHECK_VIOLATION },
  { what: 'brand_kit.logos non array', sql: kit('logos', `'{}'::jsonb`), code: CHECK_VIOLATION },
  { what: 'brand_kit.fonts non array', sql: kit('fonts', `'{}'::jsonb`), code: CHECK_VIOLATION },
  { what: 'brand_kit.images non array', sql: kit('images', `'{}'::jsonb`), code: CHECK_VIOLATION },
  { what: 'brand_kit.content_pillars non array', sql: kit('content_pillars', `'{}'::jsonb`), code: CHECK_VIOLATION },
  { what: 'brand_kit.ai_character non oggetto', sql: kit('ai_character', `'[]'::jsonb`), code: CHECK_VIOLATION },
  { what: 'brand_kit.graphic_style non oggetto', sql: kit('graphic_style', `'[]'::jsonb`), code: CHECK_VIOLATION },
  { what: 'brand_kit.about oltre il tetto', sql: kit('about', `repeat('x', 20001)`), code: CHECK_VIOLATION },
  { what: 'brand_kit.theme_color oltre il tetto', sql: kit('theme_color', `repeat('x', 41)`), code: CHECK_VIOLATION },

  { what: 'brand_articles.status fuori vocabolario', sql: article('status', `'nope'`), code: CHECK_VIOLATION },
  { what: 'brand_articles.source fuori vocabolario', sql: article('source', `'nope'`), code: CHECK_VIOLATION },
  {
    what: 'brand_articles.slug con spazi e maiuscole',
    sql: `insert into public.brand_articles (brand_id, slug, title, body_md) values ($1, 'Non Uno Slug', 'ok', 'ok')`,
    code: CHECK_VIOLATION
  },
  {
    what: 'brand_articles.title vuoto',
    sql: `insert into public.brand_articles (brand_id, slug, title, body_md) values ($1, 'ok', '   ', 'ok')`,
    code: CHECK_VIOLATION
  },
  { what: 'brand_articles.version_seq negativo', sql: article('version_seq', '-1'), code: CHECK_VIOLATION },
  { what: 'brand_articles.cover_image non http', sql: article('cover_image', `'nope'`), code: CHECK_VIOLATION },
  { what: 'brand_articles.meta_title oltre il tetto', sql: article('meta_title', `repeat('x', 301)`), code: CHECK_VIOLATION },

  { what: 'content_plans.status fuori vocabolario', sql: plan('status', `'nope'`), code: CHECK_VIOLATION },
  { what: 'content_plans.source fuori vocabolario', sql: plan('source', `'nope'`), code: CHECK_VIOLATION },
  { what: 'content_plans.editorial_week negativa', sql: plan('editorial_week', '-1'), code: CHECK_VIOLATION },
  { what: 'content_plans.editorial_week oltre l anno', sql: plan('editorial_week', '53'), code: CHECK_VIOLATION },
  { what: 'content_plans.seeds non oggetto', sql: plan('seeds', `'[]'::jsonb`), code: CHECK_VIOLATION },
  { what: 'content_plans.title oltre il tetto', sql: plan('title', `repeat('x', 301)`), code: CHECK_VIOLATION },

  { what: 'people.consent_source fuori vocabolario', sql: person('consent_source', `'nope'`), code: CHECK_VIOLATION },
  { what: 'people.images non array', sql: person('images', `'{}'::jsonb`), code: CHECK_VIOLATION },
  {
    what: 'people.name vuoto',
    sql: `insert into public.people (brand_id, name, kind) values ($1, '   ', 'real')`,
    code: CHECK_VIOLATION
  },
  { what: 'people.role oltre il tetto', sql: person('role', `repeat('x', 201)`), code: CHECK_VIOLATION },

  { what: 'competitors.website non http', sql: competitor('website', `'nope'`), code: CHECK_VIOLATION },
  { what: 'competitors.handles oggetto invece che array', sql: competitor('handles', `'{"instagram":"acme"}'::jsonb`), code: CHECK_VIOLATION },
  { what: 'competitors.top_posts non array', sql: competitor('top_posts', `'{}'::jsonb`), code: CHECK_VIOLATION },
  { what: 'competitors.top_ads non array', sql: competitor('top_ads', `'{}'::jsonb`), code: CHECK_VIOLATION },
  { what: 'competitors.benchmark non oggetto', sql: competitor('benchmark', `'[]'::jsonb`), code: CHECK_VIOLATION },
  {
    what: 'competitors.name vuoto',
    sql: `insert into public.competitors (brand_id, name) values ($1, '   ')`,
    code: CHECK_VIOLATION
  },
  { what: 'competitors.rationale oltre il tetto', sql: competitor('rationale', `repeat('x', 20001)`), code: CHECK_VIOLATION },

  {
    what: 'brand_memory.key vuota',
    sql: `insert into public.brand_memory (brand_id, category, key, value) values ($1, 'fact', '   ', 'v')`,
    code: CHECK_VIOLATION
  },
  {
    what: 'brand_memory.key oltre il tetto',
    sql: `insert into public.brand_memory (brand_id, category, key, value) values ($1, 'fact', repeat('x', 201), 'v')`,
    code: CHECK_VIOLATION
  },
  {
    what: 'brand_memory.value vuoto',
    sql: `insert into public.brand_memory (brand_id, category, key, value) values ($1, 'fact', 'k', '   ')`,
    code: CHECK_VIOLATION
  },
  {
    what: 'brand_memory.value oltre il tetto',
    sql: `insert into public.brand_memory (brand_id, category, key, value) values ($1, 'fact', 'k', repeat('x', 50001))`,
    code: CHECK_VIOLATION
  },
  { what: 'brand_memory.times_reinforced negativo', sql: memory('times_reinforced', '-1'), code: CHECK_VIOLATION },
  { what: 'brand_memory.times_used negativo', sql: memory('times_used', '-1'), code: CHECK_VIOLATION },

  { what: 'brand_sites.host con schema e maiuscole', sql: site(`'HTTPS://Blog.Brand.Com'`), code: CHECK_VIOLATION },
  { what: 'brand_sites.host senza punto', sql: site(`'localhost'`), code: CHECK_VIOLATION },
  { what: 'brand_sites.host con path', sql: site(`'blog.brand.com/feed'`), code: CHECK_VIOLATION },

  { what: 'brand_news_sources.value vuoto', sql: newsSource('value', `'   '`), code: CHECK_VIOLATION },
  { what: 'brand_news_sources.value oltre il tetto', sql: newsSource('value', `repeat('x', 501)`), code: CHECK_VIOLATION },
  { what: 'brand_news_sources.lang non un codice', sql: newsSource('value, lang', `'https://x.dev/feed', 'english'`), code: CHECK_VIOLATION }
];

function localOnly(url) {
  const { hostname } = new URL(url);

  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`DATABASE_URL punta a ${hostname}: questo harness scrive, e scrive solo in locale`);
  }
}

async function runCase(client, brandId, testCase) {
  await client.query('savepoint probe');

  try {
    await client.query(testCase.sql, [brandId]);
    await client.query('rollback to savepoint probe');

    return { ...testCase, ok: false, got: 'accettato' };
  } catch (error) {
    await client.query('rollback to savepoint probe');

    return { ...testCase, ok: error.code === testCase.code, got: error.code };
  }
}

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error('DATABASE_URL mancante');
    process.exit(2);
  }

  localOnly(url);

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query('begin');

  const brand = await client.query('select id from public.brands limit 1');

  if (!brand.rows[0]?.id) {
    console.error('nessun brand nel database locale: lancia prima `npm run db:seed`');
    process.exit(2);
  }

  const brandId = brand.rows[0].id;
  await client.query('delete from public.brand_kit where brand_id = $1', [brandId]);

  const results = [];
  for (const testCase of CASES) {
    results.push(await runCase(client, brandId, testCase));
  }

  await client.query('rollback');
  await client.end();

  for (const result of results) {
    console.log(`${result.ok ? 'ok  ' : 'FAIL'}  ${result.what}  (atteso ${result.code}, ottenuto ${result.got})`);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} vincoli mordono`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(2);
});
