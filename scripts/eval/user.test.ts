import { beforeEach, describe, expect, test, vi } from 'vitest';

const admin = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('$lib/server/supabase-admin', () => ({ createAdminClient: () => admin.client }));

const { deleteEvalUser } = await import('./user');

const USER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const BRAND = '33333333-3333-3333-3333-333333333333';

type Buckets = Record<string, string[]>;

/**
 * Storage finto che risponde come quello vero: `list` di una cartella restituisce i figli
 * DIRETTI, e una sottocartella arriva con `id: null`. È la forma che il difetto non guardava.
 */
function fakeAdmin(buckets: Buckets, escapes: string[] = []) {
  const removed: string[] = [];
  const deleted: string[] = [];
  const listed: string[] = [];

  const client = {
    storage: {
      listBuckets: async () => ({ data: Object.keys(buckets).map((name) => ({ name })), error: null }),
      from(bucket: string) {
        const objects = buckets[bucket] ?? [];
        return {
          async list(prefix: string, options?: { limit?: number; offset?: number }) {
            listed.push(`${bucket}/${prefix}`);
            const limit = options?.limit ?? 100;
            const offset = options?.offset ?? 0;
            const children = new Map<string, string | null>();
            for (const path of objects) {
              if (!path.startsWith(`${prefix}/`)) continue;
              const rest = path.slice(prefix.length + 1);
              const cut = rest.indexOf('/');
              if (cut === -1) children.set(rest, 'file-id');
              else children.set(rest.slice(0, cut), null);
            }
            for (const name of prefix === USER ? escapes : []) children.set(name, 'file-id');
            const page = [...children].map(([name, id]) => ({ name, id }));
            return { data: page.slice(offset, offset + limit), error: null };
          },
          async remove(paths: string[]) {
            removed.push(...paths.map((p) => `${bucket}/${p}`));
            return { data: null, error: null };
          }
        };
      }
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          deleted.push(id);
          return { data: null, error: null };
        }
      }
    }
  };

  admin.client = client;
  return { removed, deleted, listed };
}

describe('la pulizia dello Storage di un utente usa e getta', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('porta via gli oggetti annidati che un giro di eval produce davvero', async () => {
    const seen = fakeAdmin({
      media: [`${USER}/library/copy.png`, `${USER}/chat/attachment.jpg`],
      'brand-knowledge': [`${USER}/${BRAND}/media/import-abc.png`, `${USER}/${BRAND}/artifacts/1-plan.md`]
    });

    await deleteEvalUser(USER);

    expect(seen.removed.sort()).toEqual([
      `brand-knowledge/${USER}/${BRAND}/artifacts/1-plan.md`,
      `brand-knowledge/${USER}/${BRAND}/media/import-abc.png`,
      `media/${USER}/chat/attachment.jpg`,
      `media/${USER}/library/copy.png`
    ]);
    expect(seen.deleted).toEqual([USER]);
  });

  test('non tocca un oggetto che non è sotto il prefisso dell’utente', async () => {
    const seen = fakeAdmin({
      media: [`${USER}/library/mine.png`, `${OTHER}/library/not-mine.png`]
    });

    await deleteEvalUser(USER);

    expect(seen.removed).toEqual([`media/${USER}/library/mine.png`]);
  });

  test('un id che non è un utente non fa cancellare niente, e si sente', async () => {
    const seen = fakeAdmin({ media: [`${USER}/library/mine.png`] });
    const shouted = vi.spyOn(console, 'error').mockImplementation(() => {});

    await deleteEvalUser('');

    expect(seen.listed).toEqual([]);
    expect(seen.removed).toEqual([]);
    expect(shouted).toHaveBeenCalled();
    expect(seen.deleted).toEqual(['']);
  });

  test('un nome che risale fuori dal prefisso viene rifiutato prima della remove', async () => {
    const seen = fakeAdmin({ media: [`${USER}/library/mine.png`] }, [`../${OTHER}/stolen.png`]);
    const shouted = vi.spyOn(console, 'error').mockImplementation(() => {});

    await deleteEvalUser(USER);

    expect(seen.removed).toEqual([]);
    expect(shouted).toHaveBeenCalled();
    expect(seen.deleted).toEqual([USER]);
  });

  test('una pulizia fallita resta rumorosa e non impedisce di cancellare l’utente', async () => {
    fakeAdmin({});
    (admin.client as { storage: { listBuckets: () => Promise<unknown> } }).storage.listBuckets = async () => {
      throw new Error('storage giù');
    };
    const shouted = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(deleteEvalUser(USER)).resolves.toBeUndefined();

    expect(shouted).toHaveBeenCalled();
  });
});
