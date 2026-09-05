import { createAdminClient } from '$lib/server/supabase-admin';
import { swallow } from '$lib/server/swallow';

export type EvalUser = {
  id: string;
  email: string;
  password: string;
};

const EMAIL_DOMAIN = 'anomalia.so';
const PAGE_SIZE = 1000;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StorageEntry = { name: string; id: string | null };

type BucketApi = {
  list(
    prefix: string,
    options: { limit: number; offset: number }
  ): Promise<{ data: StorageEntry[] | null }>;
  remove(paths: string[]): Promise<unknown>;
};

type StorageApi = {
  listBuckets(): Promise<{ data: { name: string }[] | null }>;
  from(bucket: string): BucketApi;
};

export function evalEmail(now: number = Date.now()): string {
  return `eval-ux-${now}@${EMAIL_DOMAIN}`;
}

export async function createEvalUser(email: string, password: string): Promise<EvalUser> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (error || !data?.user) {
    throw new Error(`eval user creation failed: ${error?.message ?? 'no user returned'}`);
  }
  return { id: data.user.id, email, password };
}

/**
 * L'UNICO PUNTO DA CUI PASSA UNA CANCELLAZIONE, e gira in produzione.
 *
 * Il prefisso non è una convenzione da ricordare: le policy di Storage impongono
 * `(storage.foldername(name))[1] = auth.uid()::text` (migration 0004 e 0021), quindi ogni oggetto
 * di un utente sta sotto `<userId>/` e niente fuori da lì è suo. L'id deve essere un uuid perché
 * il caso che fa davvero danno è un id vuoto: `''` rende il prefisso `/`, e qualsiasi oggetto del
 * bucket passerebbe il controllo.
 */
function ownedBy(userId: string): (path: string) => string {
  if (!USER_ID.test(userId)) throw new Error(`eval teardown: '${userId}' is not a user id`);

  return (path) => {
    const segments = path.split('/');
    if (segments[0] !== userId || segments.length < 2 || segments.includes('..')) {
      throw new Error(`eval teardown refused '${path}': outside ${userId}/`);
    }
    return path;
  };
}

/** Ricorsivo: le cartelle tornano da `list` con `id` nullo, gli oggetti stanno in fondo. */
async function objectsUnder(bucket: BucketApi, prefix: string): Promise<string[]> {
  const objects: string[] = [];
  const folders = [prefix];

  while (folders.length) {
    const folder = folders.pop()!;

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data } = await bucket.list(folder, { limit: PAGE_SIZE, offset });
      if (!data?.length) break;

      for (const entry of data) {
        (entry.id === null ? folders : objects).push(`${folder}/${entry.name}`);
      }
      if (data.length < PAGE_SIZE) break;
    }
  }

  return objects;
}

/**
 * Ogni bucket, non quelli che oggi ci vengono in mente: quali ne tocca un giro di eval cambia con
 * il prodotto, e una lista scritta a mano ricomincia a perdere al primo tipo di asset nuovo.
 * Guardare in un bucket che quel prefisso non ce l'ha costa una `list` vuota.
 */
async function purgeUserStorage(storage: StorageApi, userId: string): Promise<void> {
  const owned = ownedBy(userId);
  const { data: buckets } = await storage.listBuckets();

  for (const { name } of buckets ?? []) {
    const bucket = storage.from(name);
    const objects = await objectsUnder(bucket, userId);
    if (objects.length) await bucket.remove(objects.map(owned));
  }
}

export async function deleteEvalUser(userId: string): Promise<void> {
  const admin = createAdminClient();

  // Best effort di proposito — un eval non deve fallire perché è fallita la pulizia — ma non
  // muto: i file che si sono accumulati per mesi si sono accumulati in silenzio.
  await purgeUserStorage(admin.storage, userId).catch(swallow(`eval storage teardown ${userId}`));

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`eval user teardown failed: ${error.message}`);
  }
}
