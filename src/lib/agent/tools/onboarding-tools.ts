import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Tool del setup in chat (2026-08-21).
 *
 * Lo schermo social dell'onboarding non esiste più: è l'agente, nel thread di setup, a trovare i
 * profili del brand (dal sito e cercando sul web). Trovare senza poter salvare lascerebbe il
 * lavoro a metà — `brand_social_handles` è ciò da cui la sync della history e l'apprendimento
 * della voce leggono — quindi questo è il tool di scrittura che mancava.
 *
 * File separato da tools.ts SOLO perché tools.ts è in modifica da un altro agente in questo
 * momento. Registrazione (una riga dentro createChatTools):
 *
 *   ...createOnboardingTools(supabase, brandId),
 */
export function createOnboardingTools(supabase: SupabaseClient, brandId: string) {
  return {
    save_social_handles: tool({
      description:
        "Save the brand's social profiles (the accounts it already has, found on the site or via web search) so history sync and voice learning can read them. Upserts per platform — existing rows for other platforms are untouched. Only save profiles you are confident belong to THIS brand; when unsure, ask the user to confirm first.",
      inputSchema: z.object({
        handles: z
          .array(
            z.object({
              platform: z
                .string()
                .describe('Platform key: instagram, tiktok, linkedin, facebook, x, youtube, threads, bluesky, reddit…'),
              username: z.string().optional().describe('Username without the @. Omit if you only have a URL.'),
              profile_url: z.string().optional().describe('Full profile URL (preferred for LinkedIn / Facebook pages).')
            })
          )
          .min(1)
          .max(12)
      }),
      execute: async ({ handles }: { handles: { platform: string; username?: string; profile_url?: string }[] }) => {
        const { PLATFORM_KEYS } = await import('$lib/components/platform-meta');
        const KNOWN = new Set<string>(PLATFORM_KEYS);
        // Stessa normalizzazione di parseScrapeTargets nell'onboarding: minuscole, @ via,
        // `twitter` → `x`, e una riga senza né username né URL non è un profilo.
        const rows = handles
          .map((h) => {
            const raw = String(h.platform ?? '').toLowerCase().trim();
            const platform = raw === 'twitter' ? 'x' : raw;
            const username = h.username ? String(h.username).trim().replace(/^@/, '') : null;
            const profileUrl = h.profile_url ? String(h.profile_url).trim() : null;
            if (!KNOWN.has(platform) || (!username && !profileUrl)) return null;
            return { brand_id: brandId, platform, username, profile_url: profileUrl };
          })
          .filter((r): r is NonNullable<typeof r> => !!r);
        if (!rows.length) return { error: 'No valid handles. Use known platform keys and pass a username or URL.' };
        const { error } = await supabase
          .from('brand_social_handles')
          .upsert(rows, { onConflict: 'brand_id,platform' });
        if (error) return { error: `Could not save: ${error.message}` };
        return {
          saved: rows.map((r) => ({ platform: r.platform, username: r.username, profile_url: r.profile_url })),
          note: 'Saved. Call sync_social_history to pull their post history when useful.'
        };
      }
    })
  };
}
