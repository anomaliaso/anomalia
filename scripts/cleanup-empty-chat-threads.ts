/**
 * Delete empty chat threads (no messages): post-scoped "Editor" rows and brand-level empties.
 *
 *   npx vite-node --config scripts/vite-node.config.ts scripts/cleanup-empty-chat-threads.ts
 */
import { createAdminClient } from '../src/lib/server/supabase-admin';

const admin = createAdminClient();

const { data: threads, error } = await admin.from('chat_threads').select('id, title, post_id, created_at');
if (error) {
  console.error(error);
  process.exit(1);
}

const ids = (threads ?? []).map((t) => t.id);
if (!ids.length) {
  console.log('No threads.');
  process.exit(0);
}

const { data: withMsgs, error: mErr } = await admin.from('chat_messages').select('thread_id').in('thread_id', ids);
if (mErr) {
  console.error(mErr);
  process.exit(1);
}

const hasMsg = new Set((withMsgs ?? []).map((m) => m.thread_id));
const empty = (threads ?? []).filter((t) => !hasMsg.has(t.id));

console.log(`Threads total: ${(threads ?? []).length}`);
console.log(`Empty (no messages): ${empty.length}`);
for (const t of empty.slice(0, 30)) {
  console.log(`  - ${t.id}  title=${JSON.stringify(t.title)}  post_id=${t.post_id ?? 'null'}`);
}
if (empty.length > 30) console.log(`  … +${empty.length - 30} more`);

if (!empty.length) process.exit(0);

const delIds = empty.map((t) => t.id);
const chunk = 200;
let deleted = 0;
for (let i = 0; i < delIds.length; i += chunk) {
  const slice = delIds.slice(i, i + chunk);
  const { error: dErr, count } = await admin.from('chat_threads').delete({ count: 'exact' }).in('id', slice);
  if (dErr) {
    console.error(dErr);
    process.exit(1);
  }
  deleted += count ?? slice.length;
}
console.log(`Deleted ${deleted} empty threads.`);
