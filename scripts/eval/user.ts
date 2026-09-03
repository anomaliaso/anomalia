import { createAdminClient } from '$lib/server/supabase-admin';

export type EvalUser = {
  id: string;
  email: string;
  password: string;
};

const EMAIL_DOMAIN = 'anomalia.so';

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

export async function deleteEvalUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: files } = await admin.storage.from('media').list(userId, { limit: 1000 });
  if (files?.length) {
    const paths = files.map((f) => `${userId}/${f.name}`);
    await admin.storage.from('media').remove(paths);
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`eval user teardown failed: ${error.message}`);
  }
}
