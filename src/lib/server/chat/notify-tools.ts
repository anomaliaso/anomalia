/**
 * `notify_user` — il canale dell'agente FUORI dalla chat: email (Resend) + push.
 *
 * L'agente scrive in un thread; un thread lo legge chi lo tiene aperto. Da quando i team ricorrenti
 * e i sotto-agenti lavorano per minuti — o mentre l'utente dorme — "l'ho scritto in chat" non
 * significa più "gliel'ho detto". Questo tool chiude il buco: una mail a TUTTI i contatti del
 * progetto (owner + invitati) e, in parallelo, una push su ogni dispositivo che l'ha attivata.
 *
 * Le due cose viaggiano insieme di proposito: la push è la sveglia, l'email è il contenuto che
 * resta. Non c'è un selettore di canale — la push si limita da sé (niente iscrizione, niente push).
 *
 * Tre freni, perché mandare email a nome del brand è un'azione verso il mondo esterno:
 *  - MAX_PER_TURN: un turno può bussare una volta sola (due se la seconda è davvero un altro fatto).
 *  - MAX_PER_HOUR: tetto per brand, contato sul log — è quello che tiene a bada un agente ricorrente.
 *  - Antiduplicato: stesso oggetto, stesso brand, entro DUPLICATE_WINDOW_MIN → non riparte.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env as publicEnv } from '$env/dynamic/public';
import { resolveWorkbenchPath } from './workbench-path';

/** Quante notifiche può far partire un singolo turno di chat. */
const MAX_PER_TURN = 2;
/** Tetto per brand sull'ultima ora (richiede il log: senza tabella, resta solo il tetto per turno). */
const MAX_PER_HOUR = 6;
/** Stesso oggetto entro questa finestra = doppione di un altro agente che ha finito lo stesso lavoro. */
const DUPLICATE_WINDOW_MIN = 10;

type NotifyCtx = {
  brandId: string;
  /** Utente per conto del quale gira il turno — è il mittente logico, non il destinatario. */
  userId?: string;
  threadId?: string;
  /** Origin della richiesta: in produzione è già il dominio giusto, in locale evita PUBLIC_APP_URL. */
  origin?: string;
};

function appBase(origin?: string): string {
  return (origin || publicEnv.PUBLIC_APP_URL || publicEnv.PUBLIC_FALLBACK_APP_URL || 'https://www.anomalia.so').replace(/\/$/, '');
}

export function createNotifyTools(ctx: NotifyCtx) {
  let usedThisTurn = 0;

  return {
    notify_user: tool({
      description:
        'Reach the user OUTSIDE the chat: sends an email (to every person invited to this project) AND a push notification to their devices when they enabled it. Both go together — you write the copy for each. USE IT when something actually happened while they were away and they would want to know now: a long job you finished, a recurring run with a result, something that needs their decision, an error that blocks the brand. Do NOT use it to say hello, to confirm you understood, to repeat what you already wrote in this chat while they are reading it, or after every small step — an email nobody needed is worse than no email. Max ' +
        `${MAX_PER_TURN} per turn and ${MAX_PER_HOUR} per hour for the whole brand; an identical subject within ${DUPLICATE_WINDOW_MIN} minutes is dropped as a duplicate. Write in the user's language. Tell them in chat that you sent it.`,
      inputSchema: z.object({
        subject: z
          .string()
          .min(3)
          .max(120)
          .describe(
            'Email subject AND the heading inside it. Say what happened, concretely: "Week 3 posts are ready to approve", not "Update". No brand name — it is added automatically.'
          ),
        body: z
          .string()
          .min(10)
          .max(4000)
          .describe(
            'The email itself, in plain text. Blank lines separate paragraphs, lines starting with "- " become a bulleted list, **text** is bold, bare http(s) links become clickable. Say what happened, what it means, and what (if anything) you need from them. No greeting boilerplate, no signature — the frame is added.'
          ),
        push_body: z
          .string()
          .max(140)
          .optional()
          .describe(
            'One line for the phone notification — it must stand alone on a lock screen. Defaults to the subject.'
          ),
        path: z
          .string()
          .optional()
          .describe(
            'Workbench page the notification should open, e.g. /content, /calendar, /plan, /analytics. Omit to link back to this chat thread.'
          ),
        cta_label: z
          .string()
          .max(40)
          .optional()
          .describe('Label of the button in the email, e.g. "Review the posts →". Defaults to "Open Anomalia".')
      }),
      execute: async ({ subject, body, push_body, path, cta_label }) => {
        if (usedThisTurn >= MAX_PER_TURN) {
          return {
            error: 'notify_limit_turn',
            message: `Already sent ${usedThisTurn} notification(s) this turn (max ${MAX_PER_TURN}). Say the rest in the chat instead.`
          };
        }

        const { createAdminClient } = await import('$lib/server/supabase-admin');
        const admin: SupabaseClient = createAdminClient();

        const { data: brand } = await admin
          .from('brands')
          .select('id, slug, name, org_id')
          .eq('id', ctx.brandId)
          .maybeSingle();
        if (!brand?.slug) return { error: 'brand_not_found' };

        const brandName = (brand.name as string) || 'Anomalia';
        const slug = brand.slug as string;

        // Il log serve a due cose e fallisce in un modo solo: se la tabella non è ancora applicata,
        // la notifica parte comunque e resta in piedi il tetto per turno.
        const sinceHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recent, error: recentErr } = await admin
          .from('agent_notifications')
          .select('subject, created_at')
          .eq('brand_id', ctx.brandId)
          .gte('created_at', sinceHour)
          .order('created_at', { ascending: false });

        if (!recentErr && recent) {
          if (recent.length >= MAX_PER_HOUR) {
            return {
              error: 'notify_limit_hour',
              message: `This brand already sent ${recent.length} notifications in the last hour (max ${MAX_PER_HOUR}). Say it in the chat instead.`
            };
          }
          const dupSince = Date.now() - DUPLICATE_WINDOW_MIN * 60 * 1000;
          const duplicate = recent.some(
            (r) =>
              String(r.subject ?? '').trim().toLowerCase() === subject.trim().toLowerCase() &&
              new Date(String(r.created_at)).getTime() >= dupSince
          );
          if (duplicate) {
            return {
              skipped: 'duplicate',
              message: `An identical notification went out less than ${DUPLICATE_WINDOW_MIN} minutes ago — not sending it twice.`
            };
          }
        }

        const { brandContacts } = await import('$lib/server/scheduler');
        const contacts = await brandContacts(admin, (brand.org_id as string) ?? '', ctx.brandId);
        if (!contacts.length) {
          return { error: 'no_recipients', message: 'No email on file for this project — nothing was sent.' };
        }

        // Il link: una pagina della workbench se l'agente ne ha chiesta una valida, altrimenti il
        // thread da cui sta scrivendo (che è quasi sempre il posto dove la conversazione continua).
        const resolved = path ? resolveWorkbenchPath(path, slug) : null;
        if (path && !resolved) {
          return { error: 'invalid_path', message: `Unknown workbench path "${path}".`, path };
        }
        const href =
          resolved?.href ?? (ctx.threadId ? `/app/${slug}/chat/${ctx.threadId}` : `/app/${slug}`);
        const url = `${appBase(ctx.origin)}${href}`;

        const heading = subject.trim();
        const pushLine = (push_body?.trim() || heading).slice(0, 140);

        const [
          { notifyBrandContacts, pushToBrandContacts },
          { agentNotifyEmailSubject, agentNotifyEmailHtml, agentNotifyEmailText }
        ] = await Promise.all([
          import('$lib/server/brand-notify'),
          import('$lib/server/email')
        ]);

        // Email prima, push dopo: la push è la sveglia, e svegliare qualcuno per una mail che non è
        // partita è il modo peggiore di usare questo tool.
        const emailed = await notifyBrandContacts(admin, contacts, {
          logPrefix: '[notify_user]',
          buildEmail: (locale, to) => ({
            to,
            subject: agentNotifyEmailSubject(locale, brandName, heading),
            html: agentNotifyEmailHtml(
              locale,
              { brandName, heading, body, ctaUrl: url, ctaLabel: cta_label },
              ctx.origin
            ),
            text: agentNotifyEmailText(locale, {
              brandName,
              heading,
              body,
              ctaUrl: url,
              ctaLabel: cta_label
            })
          })
        });

        const push = await pushToBrandContacts(admin, contacts, {
          title: brandName,
          body: pushLine,
          url,
          tag: `agent-notify-${ctx.brandId}`
        });

        usedThisTurn += 1;

        await admin
          .from('agent_notifications')
          .insert({
            brand_id: ctx.brandId,
            thread_id: ctx.threadId ?? null,
            user_id: ctx.userId || null,
            subject: heading,
            body,
            push_body: pushLine,
            url,
            recipients: contacts.length,
            emailed,
            pushed: push.sent
          })
          .then(
            ({ error }) => {
              if (error) console.warn('[notify_user] log insert failed:', error.message);
            },
            (e: unknown) => console.warn('[notify_user] log insert failed:', e)
          );

        return {
          sent: true,
          emailed,
          recipients: contacts.length,
          // Zero push non è un errore: vuol dire che nessuno ha attivato le notifiche su questo
          // brand. Dirlo esplicitamente evita che l'agente prometta all'utente una notifica che sul
          // telefono non è mai arrivata.
          pushed: push.sent,
          pushEnabled: push.sent > 0,
          url,
          note:
            push.sent > 0
              ? 'Email sent and push delivered.'
              : 'Email sent. No push notification was delivered (nobody has push enabled on this project).'
        };
      }
    })
  };
}
