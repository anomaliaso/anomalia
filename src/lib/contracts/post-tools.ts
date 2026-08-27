import { z } from 'zod';
import { defineContract, enumList } from './tool-contract';

/**
 * Contratti dei tool di publish-safety della chat (approve / reject / reschedule /
 * cross_post / update_post) — la prima fetta migrata al pattern dei contratti, scelta
 * perché è dove la deriva description/codice costa di più: qui una description che
 * insegna uno stato sbagliato fa pubblicare (o cancellare) il post sbagliato.
 *
 * Le COSTANTI qui sotto sono la fonte unica dei valori: le description le interpolano
 * (`enumList`), i guard in tools.ts le importano, e contracts.test.ts verifica che ogni
 * valore dichiarato compaia davvero nel testo del tool. Niente più stringhe di enum
 * riscritte a mano nel testo.
 */

// Gli stati che `posts.status` assume davvero nel sistema (vedi publish.ts: un publish
// fallito marca 'failed'; schedule.ts considera "live" i primi tre).
export const POST_STATUSES = ['pending_user', 'approved', 'scheduled', 'published', 'failed'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** Solo un draft in attesa dell'utente si può approvare. */
export const APPROVABLE_STATUSES = ['pending_user'] as const satisfies readonly PostStatus[];
/**
 * Solo post già approvati/schedulati si possono rischedulare: publishApprovedPost NON
 * controlla lo status, quindi "rischedulare" un draft lo pubblicherebbe senza
 * approvazione (lo stesso bypass dell'incidente scheduling di luglio 2026).
 */
export const RESCHEDULABLE_STATUSES = ['approved', 'scheduled'] as const satisfies readonly PostStatus[];
/** reject cancella la riga: su un post già uscito non può dis-pubblicare, quindi rifiuta. */
export const REJECTABLE_STATUSES = ['pending_user', 'approved', 'scheduled'] as const satisfies readonly PostStatus[];

/**
 * I valori che `posts.content_type` assume davvero (finding #11 dell'audit: la
 * description insegnava "carousel"/"reel"/"story", che sono FORMAT, non content type).
 */
export const POST_CONTENT_TYPES = [
  'generated_image',
  'generated_video',
  'generated_graphic',
  'uploaded_image',
  'text',
  'link'
] as const;
export type PostContentType = (typeof POST_CONTENT_TYPES)[number];

// ── update_post ──────────────────────────────────────────────────────────────

export type UpdatePostResult = {
  success: boolean;
  updated_fields: string[];
  rescheduled?: boolean;
  noAccount?: boolean;
  /** Testo pronto quando noAccount è vero — un booleano nudo si legge come "fatto". */
  message?: string;
  zernio_error?: string;
};

export const updatePostContract = defineContract<UpdatePostResult>()({
  description:
    'Edit a post draft: caption, image prompt, platforms, content type, or scheduling slot. For scheduled posts, automatically re-syncs with Zernio. Refused unless you read the post first (read_posts) — and refused again if it changed since that read.',
  inputSchema: z.object({
    post_id: z.string().describe('The post ID to update'),
    caption: z.string().optional().describe('New caption text'),
    image_prompt: z.string().optional().describe('New image generation prompt'),
    platforms: z.array(z.string()).optional().describe('Cross-post target platforms'),
    // z.enum e non z.string: prima il tool accettava "carousel" e lo scriveva in DB —
    // ora un valore fuori vocabolario è un errore di validazione che il modello vede.
    content_type: z
      .enum(POST_CONTENT_TYPES)
      .optional()
      .describe(
        `posts.content_type as the system actually stores it: ${enumList(POST_CONTENT_TYPES)}. NOT "carousel"/"reel"/"story" — those are formats, not content types (a carousel has format "carousel"; a reel is content_type "generated_video").`
      ),
    slot: z.string().optional().describe('Time slot (e.g. "Mon 09:00")'),
    product_name: z.string().optional().describe('Product featured in this post'),
    first_comment: z.string().optional().describe('First comment (hashtags/CTA)')
  }),
  enums: { content_type: POST_CONTENT_TYPES }
});

// ── approve_post ─────────────────────────────────────────────────────────────

export type ApprovePostResult = {
  success: boolean;
  noAccount: boolean;
  /** Approvato ma NON programmato: nessun account collegato per la piattaforma del post. */
  approved?: boolean;
  scheduled?: boolean;
  message?: string;
  scheduled_for?: string;
  scheduled_for_local?: string;
};

export const approvePostContract = (tz: string) =>
  defineContract<ApprovePostResult>()({
    description: `Approve a pending post draft (status ${enumList(APPROVABLE_STATUSES)}) and schedule it for publishing via Zernio.`,
    inputSchema: z.object({
      post_id: z.string().describe('The post ID to approve'),
      scheduled_for: z
        .string()
        .optional()
        .describe(
          `Datetime to publish at, in the BRAND's local time (${tz}) — e.g. "2026-06-20T09:00". Add a Z/offset only for a real UTC instant. Omit to use the post's existing slot.`
        )
    }),
    enums: { status: APPROVABLE_STATUSES }
  });

// ── reject_post ──────────────────────────────────────────────────────────────

export type RejectPostResult = { success: boolean; deleted: string };

export const rejectPostContract = defineContract<RejectPostResult>()({
  description: `Reject (delete) a post draft. Works on ${enumList(REJECTABLE_STATUSES)} posts — a live Zernio schedule is cancelled first, so the post will NOT go out. "published" posts are refused (deleting the row cannot un-publish). This is destructive — the post row is permanently removed.`,
  inputSchema: z.object({
    post_id: z.string().describe('The post ID to reject/delete'),
    confirm: z.boolean().describe('Must be true to confirm deletion')
  }),
  enums: { status: REJECTABLE_STATUSES, refused_status: ['published'] }
});

// ── reschedule_post ──────────────────────────────────────────────────────────

export type ReschedulePostResult = {
  success: boolean;
  new_time: string;
  new_time_local: string;
  noAccount: boolean;
  message?: string;
};

export const reschedulePostContract = (tz: string) =>
  defineContract<ReschedulePostResult>()({
    description: `Reschedule a post whose status is ${enumList(RESCHEDULABLE_STATUSES)} to a new date/time. Cancels existing Zernio schedule and re-publishes. Refuses ${enumList(APPROVABLE_STATUSES)} drafts — those need approve_post (optionally with scheduled_for) first. Use after list_calendar_conflicts to move overlapping posts onto free slots (spread ≥1–2h apart). Pass a concrete datetime in the BRAND's local time (${tz}) — never invent success without calling this.`,
    inputSchema: z.object({
      post_id: z.string().describe('The post ID to reschedule'),
      scheduled_for: z
        .string()
        .describe(
          `New datetime in the brand's local time (${tz}) — e.g. "2026-06-22T14:00". Add a Z/offset only for a real UTC instant.`
        )
    }),
    enums: { status: RESCHEDULABLE_STATUSES, refused_status: APPROVABLE_STATUSES }
  });

// ── cross_post ───────────────────────────────────────────────────────────────

// Un solo shape per i tre rami (pending aggiorna, scheduled rischedula, published
// clona): success + platforms + status sempre presenti; gli id del clone solo sul ramo
// published. Il fallimento del publish del clone resta netto: success:false + error,
// mai success:true con un errore dentro.
export type CrossPostResult = {
  success: boolean;
  platforms: string[];
  status: PostStatus;
  post_id?: string;
  original_post_id?: string;
  clone_post_id?: string;
  noAccount?: boolean;
  message?: string;
  error?: string;
};

export const crossPostContract = defineContract<CrossPostResult>()({
  description: `Publish an existing post to additional platforms. For ${enumList(APPROVABLE_STATUSES)} posts: updates the platforms field. For "scheduled" posts: re-schedules with the expanded platform set. For "published" posts: clones and publishes immediately to new platforms.`,
  inputSchema: z.object({
    post_id: z.string().describe('The post ID to cross-post'),
    platforms: z
      .array(z.string())
      .describe('Additional platforms to publish to (e.g. ["facebook", "threads"])')
  }),
  enums: { status: ['pending_user', 'scheduled', 'published'] satisfies readonly PostStatus[] }
});
