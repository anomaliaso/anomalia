/**
 * Short-lived, per-isolate cache of whole page-load payloads.
 *
 * The nav-cache next door memoises the two things every /app/[brand] navigation needs (the
 * verified user, the brand shell + badge bundle). This one covers the other half of a click:
 * the page's OWN load, which on the heavy dashboards is 20–30 PostgREST round trips. Those
 * are not slow because of any single query any more (see migration 0202) — they are slow
 * because each one is a separate HTTP request with its own ~10–20 ms plan, and they all
 * contend for the same small Postgres.
 *
 * So: when someone clicks through Overview → Content → Plan → Overview, the second Overview
 * is served from memory instead of re-running the whole bundle. That is the exact pattern
 * this is for — fast back-and-forth navigation — hence the short TTL. It is a latency cache,
 * not a source of truth.
 *
 * Correctness rules that keep it honest:
 *  - Keyed by user AND brand AND route AND a per-page variant (filters, pagination, week
 *    index …). Two users, two brands, or two filter states never share an entry.
 *  - TTL is seconds, not minutes, so anything written by a background job (scheduler, radar,
 *    blog worker) surfaces on the next click but one.
 *  - Any mutating request for the brand drops the whole brand's entries — wired once in
 *    hooks.server.ts rather than per action, so a new form action cannot forget to do it.
 *  - The in-flight promise is what gets cached, so a burst of concurrent loads (SSR + a
 *    prefetch, say) collapses into one set of queries. A rejected load is evicted, never
 *    served.
 *
 * One thing to keep in mind when adding a page: entries are shared by reference (the same
 * object the nav-cache already shares for the brand row and badge bundle). Load payloads here
 * are read-only view data that SvelteKit serialises per request, so nothing mutates them —
 * but a load that returns something a caller edits in place should not be cached.
 */

const TTL_MS = 45_000;
const MAX_ENTRIES = 300;

type Entry = { value: Promise<unknown>; at: number };

const entries = new Map<string, Entry>();

/** Identifies one page payload. `variant` carries whatever the load reads off the URL. */
export type PageCacheKey = {
  userId: string;
  slug: string;
  routeId: string;
  variant?: string;
};

// NUL cannot occur in a uuid, slug, route id or query string, so joining the parts on it
// means no two different keys can collide, and invalidateBrandPages can compare the slug
// field exactly rather than substring-matching a slug that might also appear in a variant.
const SEP = '\u0000';

function keyOf(k: PageCacheKey): string {
  return [k.userId, k.slug, k.routeId, k.variant ?? ''].join(SEP);
}

function prune() {
  if (entries.size <= MAX_ENTRIES) return;
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of entries) {
    if (v.at < cutoff) entries.delete(k);
  }
  // Still over budget → drop oldest-inserted first (Map preserves insertion order).
  let extra = entries.size - MAX_ENTRIES;
  if (extra <= 0) return;
  for (const k of entries.keys()) {
    entries.delete(k);
    if (--extra <= 0) break;
  }
}

/**
 * Run `load` unless an entry younger than the TTL is already there.
 *
 * Pass the same `variant` for the same visible page — if a load reads search params, they
 * belong in the variant or two different filter states will share one payload.
 */
export async function cachedPage<T>(key: PageCacheKey, load: () => Promise<T>): Promise<T> {
  const k = keyOf(key);
  const hit = entries.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;

  const value = load();
  entries.set(k, { value, at: Date.now() });
  prune();

  const evict = () => {
    const current = entries.get(k);
    if (current?.value === value) entries.delete(k);
  };
  // A failed load must not be served for the rest of the TTL, and must not surface as an
  // unhandled rejection here — the caller's own await is what reports the error.
  value.catch(evict).then((resolved) => {
    // Streamed pages return promises INSIDE the payload (see the Overview load), and those
    // settle after the load itself has resolved. Without this, one failed section would stay
    // cached as a rejected promise for the rest of the TTL and every visitor in that window
    // would get the error instead of a retry. Watching the top level is enough: that is where
    // a load puts the sections it streams.
    if (!resolved || typeof resolved !== 'object') return;
    for (const field of Object.values(resolved as Record<string, unknown>)) {
      if (isPromise(field)) field.catch(evict);
    }
  }, () => {});
  return value;
}

function isPromise(v: unknown): v is Promise<unknown> {
  return !!v && typeof (v as Promise<unknown>).then === 'function';
}

/**
 * Drop every cached page of a brand, for every user. Called from hooks.server.ts after any
 * mutating request for the brand, so an approve/generate/settings write is visible on the
 * very next navigation.
 */
export function invalidateBrandPages(slug: string): void {
  for (const k of entries.keys()) {
    if (k.split(SEP)[1] === slug) entries.delete(k);
  }
}

/** The slice of a SvelteKit load event `cachedBrandPage` needs. */
type BrandPageEvent = {
  route: { id: string | null };
  locals: { safeGetSession: () => Promise<{ user: { id: string } | null }> };
};

/**
 * `cachedPage` for an /app/[brand] page load, which is how every caller uses it.
 *
 * Resolves the viewer from the (per-request memoised) session and keys on them, so the cache
 * can never serve one teammate's payload to another. An anonymous request — there shouldn't
 * be one under /app, but a load runs before any redirect resolves — is simply not cached.
 *
 * `variant` must include anything the load reads off the URL. A page whose payload changes
 * with `?week=2` and does not pass it would serve week 0's data for week 2.
 */
export function cachedBrandPage<T>(
  event: BrandPageEvent,
  slug: string,
  load: () => Promise<T>,
  variant?: string
): Promise<T> {
  return event.locals.safeGetSession().then(({ user }) => {
    if (!user) return load();
    return cachedPage({ userId: user.id, slug, routeId: event.route.id ?? '', variant }, load);
  });
}

/** Drop a single user's copy of one route (a page that just mutated its own state). */
export function invalidatePage(key: PageCacheKey): void {
  entries.delete(keyOf(key));
}

/** Test seam. */
export function resetPageCache(): void {
  entries.clear();
}

/** Test seam — entry count, so tests can assert eviction without reaching into the Map. */
export function pageCacheSize(): number {
  return entries.size;
}
