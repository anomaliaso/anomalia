// Shared blog writing style: the sentence-case default + the brand's custom instructions
// (blog_config.styleInstructions). Used by BOTH the article generator and the per-article edit chat
// so a generated article and its later edits follow the same rules.
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/** The user's custom writing instructions for this brand's blog (empty string if none). */
export async function blogStyleInstructions(admin: SupabaseClient, brandId: string): Promise<string> {
  const { data } = await admin.from('brands').select('blog_config').eq('id', brandId).maybeSingle();
  return String((data?.blog_config as AnyRec)?.styleInstructions ?? '').trim().slice(0, 1500);
}

/** STYLE block appended to every blog writing/editing prompt: sentence-case default headings +
 *  the brand's custom instructions (which take priority when they conflict). */
export function blogStyleBlock(styleInstructions: string): string {
  return `STYLE:
- Titles and ALL headings (title, metaTitle, ## and ###): sentence case — capitalize ONLY the first word and proper nouns or words grammar requires. Never Title-Case every word. E.g. "Come scegliere un CRM" not "Come Scegliere Un CRM".
- Prefer plain, natural phrasing over marketing clichés; avoid ALL-CAPS and gratuitous emoji.${styleInstructions ? `\n\nBRAND STYLE INSTRUCTIONS (highest priority — follow these, they override the generic style above where they conflict):\n${styleInstructions}` : ''}`;
}
