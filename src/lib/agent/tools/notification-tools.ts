/**
 * `read_notifications` / `set_notification` — la campanella della sidebar, vista dagli agenti.
 *
 * Lettura: la stessa lista che l'utente vede (warning calcolati + notifiche degli agenti).
 * Scrittura: SOLO `indication` e `warning` — `error` è riservato ai fatti di sistema, e l'enum
 * semplicemente non lo contiene. Dedup per topic, tetto per brand, link al thread d'origine:
 * i freni stanno in brand-warnings.ts, qui c'è solo la superficie del tool.
 *
 * Il valore della campanella è la scarsità: la description dice al modello soprattutto quando NON
 * notificare. Storage: righe `agent:*` nella tabella `incidents` esistente — nessuna migration.
 */
import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listAgentNotices,
  loadBrandWarnings,
  upsertAgentNotice,
  resolveAgentNotice,
  MAX_OPEN_AGENT_NOTICES
} from '$lib/server/brand-warnings';

type Ctx = {
  supabase: SupabaseClient;
  brandId: string;
  threadId?: string;
  /** Iniettabile nei test; a runtime si usa createAdminClient (incidents è RLS service-role). */
  admin?: SupabaseClient;
};

async function getAdmin(ctx: Ctx): Promise<SupabaseClient | null> {
  if (ctx.admin) return ctx.admin;
  try {
    const { createAdminClient } = await import('$lib/server/supabase-admin');
    return createAdminClient();
  } catch {
    return null; // ambienti senza service key: si degrada, non si esplode
  }
}

export function createNotificationTools(ctx: Ctx) {
  const { supabase, brandId, threadId } = ctx;

  return {
    read_notifications: tool({
      description:
        "The user's notification bell (sidebar), in full: computed brand warnings (broken accounts, failed posts, quota, setup gaps, …) plus notes written by agents via set_notification. Severity-tagged, open items only. Consult it when deciding what to do next or reporting on brand health; the system prompt already carries the top of this list.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional().describe('Max items to return (default 30).'),
        offset: z.number().int().min(0).optional().describe('Skip this many items (pagination).')
      }),
      execute: async ({ limit, offset }: { limit?: number; offset?: number }) => {
        const { data: brand } = await supabase
          .from('brands')
          .select(
            'id, slug, plan, status, timezone, target_platforms, content_prefs, blog_config, autopilot_failure_count, onboarding_completed_at'
          )
          .eq('id', brandId)
          .maybeSingle();
        if (!brand) return { error: 'brand_not_found' };
        const admin = await getAdmin(ctx);
        const [warnings, notices] = await Promise.all([
          loadBrandWarnings(supabase, brand),
          admin ? listAgentNotices(admin, brandId) : Promise.resolve([])
        ]);
        const items = [
          ...notices.map((n) => ({
            kind: 'agent' as const,
            topic: n.topic,
            severity: n.severity,
            title: n.title,
            message: n.message,
            thread_id: n.thread_id,
            detected_at: n.detected_at
          })),
          ...warnings.map((w) => ({
            kind: 'computed' as const,
            id: w.id,
            severity: w.severity,
            values: w.values ?? null,
            href: w.href ?? null
          }))
        ];
        const off = offset ?? 0;
        const lim = limit ?? 30;
        return {
          total: items.length,
          offset: off,
          notifications: items.slice(off, off + lim),
          note: 'computed items resolve themselves when the underlying condition clears; agent items are yours — resolve them with set_notification{resolve:true} when no longer true.'
        };
      }
    }),

    set_notification: tool({
      description:
        `Write (or resolve) ONE persistent note in the user's notification bell — for something that needs their attention INDEPENDENT of any conversation, discovered while working: a trend they should act on, a risk building up, a decision only they can take. It stays in the sidebar until resolved and links back to this thread. DO NOT use it for: anything you already said in the active conversation (they are reading it), anything they will see as an unread-thread badge anyway, routine run reports (those live in the thread), greetings or progress. A notification that duplicates chat or a badge is noise twice — when in doubt, don't. Same topic upserts (never duplicates); max ${MAX_OPEN_AGENT_NOTICES} open per brand, so resolve stale ones first. Severity is only 'indication' (FYI/opportunity) or 'warning' (needs action soon) — 'error' belongs to the system. Call with resolve:true to close a topic the moment it stops being true. Write title/message in the user's language.`,
      inputSchema: z.object({
        topic: z
          .string()
          .min(2)
          .max(80)
          .describe(
            'Stable dedup key for THIS subject, kebab-case (e.g. "linkedin-token-expiring", "competitor-price-drop"). Reusing the topic updates the open notification instead of adding another.'
          ),
        // NIENTE 'error' qui — riservato ai fatti di sistema, per costruzione.
        severity: z
          .enum(['indication', 'warning'])
          .optional()
          .describe("'indication' = FYI/opportunity, 'warning' = needs action soon. Ignored with resolve:true."),
        title: z.string().min(3).max(90).optional().describe('Short headline the user sees in the bell. Required unless resolving.'),
        message: z
          .string()
          .min(3)
          .max(500)
          .optional()
          .describe('One or two sentences: what is happening and why it matters. Required unless resolving.'),
        resolve: z
          .boolean()
          .optional()
          .describe('true = close the open notification with this topic (no title/message needed).')
      }),
      execute: async ({
        topic,
        severity,
        title,
        message,
        resolve
      }: {
        topic: string;
        severity?: 'indication' | 'warning';
        title?: string;
        message?: string;
        resolve?: boolean;
      }) => {
        const admin = await getAdmin(ctx);
        // Fail-soft: senza service key (o senza tabella) il tool risponde chiaro e il turno continua.
        if (!admin) {
          return { error: 'notifications_unavailable', message: 'Notification storage is not available in this environment. Tell the user in chat instead.' };
        }
        if (resolve) {
          const r = await resolveAgentNotice(admin, brandId, topic);
          if (r.error) return { error: 'notifications_unavailable', message: r.error };
          return r.resolved
            ? { resolved: true, topic }
            : { resolved: false, topic, note: 'no open notification with this topic' };
        }
        if (!title || !message) {
          return { error: 'missing_fields', message: 'title and message are required unless resolve:true' };
        }
        const res = await upsertAgentNotice(admin, {
          brandId,
          topic,
          severity: severity ?? 'indication',
          title,
          message,
          threadId: threadId ?? null
        });
        if (res.status === 'error') return { error: 'notifications_unavailable', message: res.message };
        if (res.status === 'cap_reached') {
          return {
            error: 'notification_cap',
            message: `This brand already has ${res.open_count}/${res.max} open agent notifications. Resolve one that is no longer true (set_notification{topic, resolve:true}) before adding another — the bell only works if it stays scarce.`
          };
        }
        return { ok: true, status: res.status, topic: res.topic, open_count: res.open_count };
      }
    })
  };
}
