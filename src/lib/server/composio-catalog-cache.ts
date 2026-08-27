import { swallow } from '$lib/server/swallow';
/**
 * TTL cache for the Composio toolkit directory.
 *
 * The catalog is 1000+ toolkits behind a cursor-paginated endpoint: fetching it on every load of
 * Settings → Connectors costs a dozen sequential API calls against a per-organization rate limit,
 * for a list that changes about as often as Composio ships a new integration. Stale entries are
 * served while a refresh runs in the background, so a page load never waits on the network twice.
 */

export const TOOLKIT_DIRECTORY_TTL_MS = 60 * 60 * 1000;

export function createDirectoryCache<T>(opts?: { ttlMs?: number; now?: () => number }) {
  const ttlMs = opts?.ttlMs ?? TOOLKIT_DIRECTORY_TTL_MS;
  const now = opts?.now ?? Date.now;
  let entry: { items: T[]; fetchedAt: number } | undefined;
  let inflight: Promise<T[]> | undefined;

  async function load(loader: () => Promise<T[]>): Promise<T[]> {
    // One loader at a time: a burst of page loads must not fan out into a burst of API calls.
    inflight ??= loader()
      .then((items) => {
        entry = { items, fetchedAt: now() };
        return items;
      })
      .finally(() => {
        inflight = undefined;
      });
    return inflight;
  }

  return {
    peek(): T[] | undefined {
      return entry?.items;
    },
    async get(loader: () => Promise<T[]>): Promise<T[]> {
      if (!entry) return load(loader);
      if (now() - entry.fetchedAt < ttlMs) return entry.items;
      // Stale: refresh in the background and answer now with what we have.
      if (!inflight) void load(loader).catch((error) => { swallow('load failed', error); return undefined; });
      return entry.items;
    },
    invalidate() {
      entry = undefined;
    }
  };
}
