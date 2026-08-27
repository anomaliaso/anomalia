/**
 * Load converted markdown from Storage when the chat POST only sent a path
 * (large files — the JSON body cannot carry 100 MB of text).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isChatConvertMarkdownPath, type ChatDocument } from '$lib/chat-documents';

const BUCKET = 'brand-knowledge';

export async function hydrateChatDocuments(
  supabase: SupabaseClient,
  userId: string,
  brandId: string,
  docs: ChatDocument[]
): Promise<ChatDocument[]> {
  const out: ChatDocument[] = [];
  for (const d of docs) {
    if (d.markdown.trim()) {
      out.push(d);
      continue;
    }
    const path = d.path?.trim() ?? '';
    if (!isChatConvertMarkdownPath(path, userId, brandId)) continue;
    const dl = await supabase.storage.from(BUCKET).download(path);
    if (dl.error || !dl.data) continue;
    const markdown = (await dl.data.text()).trim();
    if (!markdown) continue;
    out.push({ ...d, markdown, path });
  }
  return out;
}
