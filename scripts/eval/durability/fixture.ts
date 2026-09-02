/**
 * Il brand usa e getta su cui girano gli scenari di durabilità. Tutto appeso all'utente:
 * cancellare lui porta via organizzazione, brand, thread, run e messaggi in cascata, ed è
 * l'unica garanzia che regge anche quando lo scenario muore a metà.
 */
import { createAdminClient } from '$lib/server/supabase-admin';
import { createEvalUser, deleteEvalUser } from '../ux/user';

export type Fixture = {
  userId: string;
  orgId: string;
  brandId: string;
  threadId: string;
};

export async function createFixture(tag: string): Promise<Fixture> {
  const admin = createAdminClient();
  const stamp = `${Date.now()}-${tag}`;
  const user = await createEvalUser(`eval-durability-${stamp}@anomalia.so`, `pw-${stamp}`);

  // La creazione che fallisce a METÀ è il caso che perde davvero: l'utente esiste già e chi
  // chiama non riceve un fixture da distruggere. Qui si ripulisce da soli prima di rilanciare.
  try {
    const org = await insert(admin, 'organizations', { name: `Eval ${stamp}`, owner_id: user.id });
    await link(admin, 'org_members', { org_id: org.id, user_id: user.id });
    const brand = await insert(admin, 'brands', {
      org_id: org.id,
      slug: `eval-${stamp}`.slice(0, 60),
      name: `Eval ${stamp}`
    });
    await link(admin, 'brand_members', { brand_id: brand.id, user_id: user.id });
    const thread = await insert(admin, 'chat_threads', { brand_id: brand.id, user_id: user.id });

    return { userId: user.id, orgId: org.id, brandId: brand.id, threadId: thread.id };
  } catch (e) {
    await admin.from('organizations').delete().eq('owner_id', user.id);
    await deleteEvalUser(user.id).catch(() => undefined);
    throw e;
  }
}

/**
 * Cancellare l'utente NON basta: il brand pende dall'organizzazione, non da lui, e resta a
 * terra. Gli avanzi di `eval:ux` in produzione — un brand per giro dal 24 agosto — sono
 * esattamente questo. L'organizzazione se ne va per prima e porta via il brand in cascata.
 */
export async function destroyFixture(fixture: Fixture | null): Promise<void> {
  if (!fixture) return;
  const admin = createAdminClient();
  // `ai_calls` punta al brand con una FK SENZA cascata: un fixture che ha speso una chiamata al
  // modello non si lascia cancellare, e il brand usa e getta resta a terra per sempre. Le righe di
  // log se ne vanno per prime — è il brand a essere usa e getta, non la contabilità di qualcun altro.
  await admin.from('ai_calls').delete().eq('brand_id', fixture.brandId);
  const { error } = await admin.from('organizations').delete().eq('id', fixture.orgId);
  if (error) throw new Error(`fixture: teardown organizzazione fallito — ${error.message}`);
  await deleteEvalUser(fixture.userId);
}

/** Le tabelle di collegamento non hanno `id`: si inserisce e basta, senza chiedere una chiave. */
async function link(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  row: Record<string, unknown>
): Promise<void> {
  const { error } = await admin.from(table).insert(row);
  if (error) throw new Error(`fixture: collegamento su ${table} fallito — ${error.message}`);
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
