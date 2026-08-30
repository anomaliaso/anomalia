/**
 * Il brand usa e getta su cui girano gli scenari di durabilità. Tutto appeso all'utente:
 * cancellare lui porta via organizzazione, brand, thread, run e messaggi in cascata, ed è
 * l'unica garanzia che regge anche quando lo scenario muore a metà.
 */
import { createAdminClient } from '$lib/server/supabase-admin';
import { createEvalUser, deleteEvalUser } from '../ux/user';

export type Fixture = {
  userId: string;
  brandId: string;
  threadId: string;
};

export async function createFixture(tag: string): Promise<Fixture> {
  const admin = createAdminClient();
  const stamp = `${Date.now()}-${tag}`;
  const user = await createEvalUser(`eval-durability-${stamp}@anomalia.so`, `pw-${stamp}`);

  const org = await insert(admin, 'organizations', { name: `Eval ${stamp}`, owner_id: user.id });
  await insert(admin, 'org_members', { org_id: org.id, user_id: user.id });
  const brand = await insert(admin, 'brands', {
    org_id: org.id,
    slug: `eval-${stamp}`.slice(0, 60),
    name: `Eval ${stamp}`
  });
  await insert(admin, 'brand_members', { brand_id: brand.id, user_id: user.id });
  const thread = await insert(admin, 'chat_threads', { brand_id: brand.id, user_id: user.id });

  return { userId: user.id, brandId: brand.id, threadId: thread.id };
}

export async function destroyFixture(fixture: Fixture | null): Promise<void> {
  if (!fixture) return;
  await deleteEvalUser(fixture.userId);
}

async function insert(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  row: Record<string, unknown>
): Promise<{ id: string }> {
  const { data, error } = await admin.from(table).insert(row).select('id').single();
  if (error) throw new Error(`fixture: insert su ${table} fallito — ${error.message}`);
  return data as { id: string };
}
