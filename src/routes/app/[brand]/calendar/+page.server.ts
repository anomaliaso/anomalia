import { swallow } from '$lib/server/swallow';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { countCalendarConflicts } from '$lib/server/schedule';
import { remaining } from '$lib/server/usage';
import { publishApprovedPost, syncDuePosts, type ApprovablePost } from '$lib/server/publish';
import { signApproveToken } from '$lib/server/token';
import { sendEmail, approvalEmailHtml, approvalEmailText, approvalEmailSubject } from '$lib/server/email';
import {
  EDITOR_POST_COLS,
  decoratePosts,
  buildBusyDays,
  applyPostEdits,
  deletePostCancellingZernio,
  editorActions
} from '$lib/server/post-editing';
import { founderVideoBudget, listVideoRequests } from '$lib/server/video-requests';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cachedBrandPage } from '$lib/server/page-cache';
import { viewFor, type PostDetail } from '$lib/post-state';
import { captionPatch } from '$lib/post-caption';

/** Il risultato che `PostPanel` legge: `id` dice a quale post appartiene, e senza quello il
 *  pannello mostrerebbe l'esito di un'altra riga. */
type PanelOutcome = {
  id: string | null;
  message: string | null;
  saved: boolean;
  approved: boolean;
  status: string | null;
};

function panelOutcome(partial: Partial<PanelOutcome>): PanelOutcome {
  return { id: null, message: null, saved: false, approved: false, status: null, ...partial };
}

function brandApi(slug: string, path: string): string {
  return `/api/v1/brands/${encodeURIComponent(slug)}${path}`;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed (${res.status})`;
}

/**
 * Il dettaglio del post aperto nel pannello. Passa dall'endpoint invece che da Supabase perche'
 * la' le URL dei media sono gia' firmate: rifarlo qui vorrebbe dire riscrivere quella firma.
 */
async function readPostDetail(
  fetcher: typeof fetch,
  token: string,
  slug: string,
  id: string
): Promise<PostDetail | null> {
  const res = await fetcher(brandApi(slug, `/posts/${encodeURIComponent(id)}/media`), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;

  const detail = (await res.json()) as PostDetail & { error?: string };
  return detail.error ? null : detail;
}

function parseIds(form: FormData, key = 'ids'): string[] {
  return String(form.get(key) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const FILTERABLE = new Set(['pending_user', 'approved', 'scheduled', 'published', 'failed']);

/** Display row for the month/list calendar (social posts + blog articles). */
export type CalendarPost = {
  id: string;
  kind: 'social' | 'blog';
  platform: string | null;
  platforms?: string[] | null;
  caption: string | null;
  media_url: string | null;
  media_urls?: string[] | null;
  content_type?: string | null;
  status: string;
  scheduled_for: string;
  dayKey: string;
  time: string;
  whenLabel: string;
  isDraft: boolean;
  slug?: string;
  needs_attention?: boolean | null;
  attention_reason?: string | null;
  weekOf?: string;
  pillar?: string | null;
  angle?: string | null;
  product_name?: string | null;
  format?: string | null;
  lastError?: string | null;
  /** Full decorated social row for PostEditor — absent for blog. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editorPost?: any;
};

const pad = (n: number) => String(n).padStart(2, '0');

function zonedParts(iso: string, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute };
}

export const load: PageServerLoad = async (event) => {
  const { supabase } = event.locals;
  const url = event.url;
  const { brand } = await event.parent();
  const { session } = await event.locals.safeGetSession();

  // Outside the cached callback on purpose: this is a fire-and-forget reconciliation, not part
  // of the payload, and burying it inside would mean a cache hit silently skips it — a
  // just-published post could then look scheduled for the whole TTL instead of one view.
  // Don't block the calendar on Zernio status checks (N HTTP calls for due posts).
  void syncDuePosts(supabase, brand.id).catch(swallow('sync due posts'));

  return cachedBrandPage(event, brand.slug, async () => {
    const tz = brand.timezone;
    const now = new Date();

    const today = zonedParts(now.toISOString(), tz);
    const mm = (url.searchParams.get('m') ?? '').match(/^(\d{4})-(\d{2})$/);
    const year = mm ? +mm[1] : today.year;
    const month = mm ? +mm[2] : today.month;

    const status = url.searchParams.get('status') ?? '';
    const filter = FILTERABLE.has(status) ? status : '';
    const rowFilter = url.searchParams.get('row') ?? '';
    const selectedId = url.searchParams.get('post');

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));
    const qStart = new Date(monthStart.getTime() - 7 * 864e5).toISOString();
    const qEnd = new Date(monthEnd.getTime() + 8 * 864e5).toISOString();

    let scheduledQ = supabase
      .from('posts')
      .select(`${EDITOR_POST_COLS}, created_at`)
      .eq('brand_id', brand.id)
      .neq('status', 'pending_user')
      .not('scheduled_for', 'is', null)
      .gte('scheduled_for', qStart)
      .lte('scheduled_for', qEnd)
      .order('scheduled_for', { ascending: true });
    if (filter === 'pending_user') {
      scheduledQ = scheduledQ.limit(0);
    } else if (filter) {
      scheduledQ = scheduledQ.eq('status', filter);
    }
    if (rowFilter) scheduledQ = scheduledQ.eq('plan_row_id', rowFilter);

    let draftQ = supabase
      .from('posts')
      .select(`${EDITOR_POST_COLS}, created_at`)
      .eq('brand_id', brand.id)
      .eq('status', 'pending_user');
    if (filter && filter !== 'pending_user') draftQ = draftQ.limit(0);
    if (rowFilter) draftQ = draftQ.eq('plan_row_id', rowFilter);

    const [
      { data: rows, error: rowsErr },
      { data: draftRows },
      { data: articleRows },
      { data: allRows },
      budget,
      { data: accts },
      { data: brandRow },
      founderVideos,
      videoRequests
    ] = await Promise.all([
      scheduledQ,
      draftQ,
      filter && filter !== 'published' && filter !== 'scheduled' && filter !== 'approved'
        ? Promise.resolve({ data: [] as never[] })
        : supabase
            .from('brand_articles')
            .select('id, title, slug, status, scheduled_for, published_at, cover_image')
            .eq('brand_id', brand.id)
            .or(
              `and(scheduled_for.gte.${qStart},scheduled_for.lte.${qEnd}),and(published_at.gte.${qStart},published_at.lte.${qEnd})`
            ),
      supabase.from('posts').select('status').eq('brand_id', brand.id),
      remaining(supabase, brand.id, brand.plan, brand.timezone),
      supabase.from('social_accounts').select('platform').eq('brand_id', brand.id).eq('status', 'active'),
      supabase.from('brands').select('target_platforms').eq('id', brand.id).maybeSingle(),
      founderVideoBudget(supabase, brand.id, brand.plan, tz),
      listVideoRequests(supabase, brand.id)
    ]);

    if (rowsErr) console.error('[calendar] posts query failed:', rowsErr.message);

    const counts = { all: 0, pending_user: 0, approved: 0, scheduled: 0, published: 0, failed: 0 };
    for (const r of allRows ?? []) {
      counts.all += 1;
      const s = String(r.status);
      if (s in counts) (counts as Record<string, number>)[s] += 1;
    }

    const dayLabelFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });

    const socialRaw = [...(rows ?? []), ...(draftRows ?? [])];
    const decorated = decoratePosts(socialRaw, tz, now);

    const failedIds = decorated.filter((p) => p.status === 'failed').map((p) => p.id);
    if (failedIds.length) {
      const { data: errLogs } = await supabase
        .from('publish_logs')
        .select('post_id, error')
        .in('post_id', failedIds)
        .eq('status', 'failed')
        .not('error', 'is', null)
        .order('created_at', { ascending: false });
      const firstErr = new Map<string, string>();
      for (const l of errLogs ?? []) if (l.error && !firstErr.has(l.post_id)) firstErr.set(l.post_id, l.error);
      for (const p of decorated) {
        const e = firstErr.get(p.id);
        if (e) (p as Record<string, unknown>).lastError = e;
      }
    }

    const socialCal: CalendarPost[] = decorated.map((p) => {
      const iso = p.whenISO;
      const z = zonedParts(iso, tz);
      const time = `${pad(z.hour)}:${pad(z.minute)}`;
      const isDraft = p.status === 'pending_user';
      return {
        id: p.id,
        kind: 'social' as const,
        platform: p.platform ?? null,
        platforms: (p as { platforms?: string[] | null }).platforms ?? null,
        caption: p.caption ?? null,
        media_url: p.media_url ?? null,
        media_urls: (p as { media_urls?: string[] | null }).media_urls ?? null,
        content_type: (p as { content_type?: string | null }).content_type ?? null,
        status: p.status,
        scheduled_for: iso,
        dayKey: p.dayKey,
        time,
        whenLabel: `${dayLabelFmt.format(new Date(iso))} · ${time}`,
        isDraft,
        needs_attention: (p as { needs_attention?: boolean | null }).needs_attention ?? null,
        attention_reason: (p as { attention_reason?: string | null }).attention_reason ?? null,
        weekOf: p.weekOf,
        pillar: (p as { pillar?: string | null }).pillar ?? null,
        angle: (p as { angle?: string | null }).angle ?? null,
        product_name: (p as { product_name?: string | null }).product_name ?? null,
        format: (p as { format?: string | null }).format ?? null,
        lastError: (p as { lastError?: string | null }).lastError ?? null,
        editorPost: p
      };
    });

    const articleCal: CalendarPost[] = ((articleRows ?? []) as Array<Record<string, unknown>>)
      .map((a): CalendarPost | null => {
        const iso = (a.published_at as string | null) || (a.scheduled_for as string | null);
        if (!iso) return null;
        if (filter === 'published' && a.status !== 'published') return null;
        if (filter === 'scheduled' && a.status === 'published') return null;
        const z = zonedParts(iso, tz);
        const time = `${pad(z.hour)}:${pad(z.minute)}`;
        return {
          id: a.id as string,
          kind: 'blog' as const,
          platform: null,
          caption: (a.title as string) ?? null,
          media_url: (a.cover_image as string | null) ?? null,
          status: a.status as string,
          scheduled_for: iso,
          dayKey: `${z.year}-${pad(z.month)}-${pad(z.day)}`,
          time,
          whenLabel: `${dayLabelFmt.format(new Date(iso))} · ${time}`,
          isDraft: a.status !== 'published',
          slug: a.slug as string
        };
      })
      .filter((x): x is CalendarPost => x !== null);

    const posts = [...socialCal, ...articleCal].sort((a, b) =>
      a.scheduled_for.localeCompare(b.scheduled_for)
    );

    const busyDays = buildBusyDays(decorated);

    const conflictCount = countCalendarConflicts(
      socialRaw as { scheduled_for: string | null; status: string; slot: string | null }[],
      tz,
      now
    );

    const connectedPlatforms = [
      ...new Set((accts ?? []).map((a) => (a.platform ?? '').toLowerCase()).filter(Boolean))
    ];
    const targetPlatforms = [
      ...new Set([
        ...(Array.isArray(brandRow?.target_platforms)
          ? (brandRow.target_platforms as string[]).map((p) => String(p).toLowerCase())
          : []),
        ...connectedPlatforms
      ])
    ];

    const todayKey = `${today.year}-${pad(today.month)}-${pad(today.day)}`;
    const monthLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'long',
      year: 'numeric'
    }).format(new Date(Date.UTC(year, month - 1, 1)));
    const prev = new Date(Date.UTC(year, month - 2, 1));
    const next = new Date(Date.UTC(year, month, 1));

    return {
      posts,
      conflictCount,
      filter,
      rowFilter,
      counts,
      usage: {
        postsUsed: budget.postsUsed,
        postsQuota: budget.postsQuota,
        postsRemaining: budget.posts
      },
      busyDays,
      connectedPlatforms,
      targetPlatforms,
      founderVideos,
      videoRequests,
      timezone: tz,
      todayKey,
      nowISO: now.toISOString(),
      year,
      month,
      monthLabel,
      prevYM: `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}`,
      nextYM: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}`,
      currentYM: `${today.year}-${pad(today.month)}`,
      isCurrentMonth: year === today.year && month === today.month,
      // La vista sta nell'URL, non nel client: un calendario in lista si manda a un collega.
      view: viewFor(url.searchParams.get('view')),
      selectedId,
      detail:
        selectedId && session
          ? await readPostDetail(event.fetch, session.access_token, brand.slug, selectedId)
          : null
    };
  }, ['m', 'status', 'row', 'post', 'view'].map((k) => url.searchParams.get(k)).join('|'));
};

export const actions: Actions = {
  /**
   * Le due azioni del pannello. Passano dagli endpoint invece che da Supabase perche' `approve`
   * non e' un `update`: dietro c'e' la coda di distribuzione, e riscriverla qui vorrebbe dire
   * tenerne due versioni.
   */
  editPost: async ({ request, params, fetch, locals }) => {
    const { session } = await locals.safeGetSession();
    if (!session) redirect(303, '/login');

    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    if (!id) return fail(400, panelOutcome({ message: 'Missing post.' }));

    const patch = captionPatch(form);
    if (typeof patch === 'string') return fail(400, panelOutcome({ id, message: patch }));

    const res = await fetch(brandApi(params.brand, `/posts/${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(patch)
    });

    if (!res.ok) return fail(res.status, panelOutcome({ id, message: await readError(res) }));

    return panelOutcome({ id, saved: true });
  },

  approvePost: async ({ request, params, fetch, locals }) => {
    const { session } = await locals.safeGetSession();
    if (!session) redirect(303, '/login');

    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    if (!id) return fail(400, panelOutcome({ message: 'Missing post.' }));

    const res = await fetch(brandApi(params.brand, `/posts/${encodeURIComponent(id)}/approve`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` }
    });

    const result = (await res.json().catch(() => null)) as
      | { status?: string; message?: string; error?: string }
      | null;

    if (!res.ok || result?.error) {
      return fail(
        res.ok ? 400 : res.status,
        panelOutcome({ id, message: result?.error ?? 'Approval failed.' })
      );
    }

    return panelOutcome({
      id,
      approved: true,
      status: result?.status ?? 'approved',
      message: result?.message ?? null
    });
  },

  updateCaption: async ({ request, locals: { supabase, user } }) => {
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    const caption = String(data.get('caption') ?? '').trim();
    if (!id) return fail(400, { error: 'Missing post' });
    if (!caption) return fail(400, { error: 'Caption cannot be empty' });
    const { error } = await applyPostEdits(supabase, id, { caption }, { by: user?.id });
    if (error) return fail(500, { error: error.message });
    return { updated: id };
  },

  // Prima scriveva un publish_log 'canceled' e cancellava la riga SENZA mai revocare Zernio:
  // il log dichiarava una cancellazione inesistente e il post usciva comunque (classe incidente
  // scheduling luglio 2026). Ora la revoca viene prima; se fallisce, il post resta visibile.
  deletePost: async ({ request, locals: { supabase, user } }) => {
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing post' });
    const res = await deletePostCancellingZernio(supabase, id, undefined, user?.id);
    if (!res.ok) return fail(res.status, { error: res.message });
    return { deleted: id, wasScheduled: res.wasScheduled };
  },

  approveWeek: async ({ request, params, locals: { supabase, user } }) => {
    const form = await request.formData();
    const ids = parseIds(form);
    if (!ids.length) return {};
    const { data: brand } = await supabase
      .from('brands')
      .select('id, timezone')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand) return {};
    const { data: pending } = await supabase
      .from('posts')
      .select(EDITOR_POST_COLS)
      .eq('brand_id', brand.id)
      .eq('status', 'pending_user')
      .in('id', ids);
    let noAccount = false;
    for (const post of pending ?? []) {
      const res = await publishApprovedPost(
        supabase,
        post as ApprovablePost,
        brand.timezone ?? 'Europe/Rome',
        { by: user?.id }
      );
      if (res.noAccount) noAccount = true;
    }
    return { ok: true, noAccount, approved: (pending ?? []).length };
  },

  /** Bulk-delete selected social posts (same-type multi-select). */
  deleteSelected: async ({ request, params, locals: { supabase, user } }) => {
    const ids = parseIds(await request.formData());
    if (!ids.length) return fail(400, { error: 'No posts selected' });
    const { data: brand } = await supabase
      .from('brands')
      .select('id')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand) return fail(404, { error: 'Brand not found' });

    const { data: posts } = await supabase
      .from('posts')
      .select('id')
      .eq('brand_id', brand.id)
      .in('id', ids);
    if (!posts?.length) return fail(404, { error: 'Posts not found' });

    // Stessa classe dell'incidente scheduling di luglio 2026: il bulk scriveva log 'canceled'
    // e cancellava le righe senza mai revocare Zernio. Ora ogni post passa dalla revoca; chi
    // non si riesce a revocare NON viene eliminato e il fallimento arriva all'utente.
    let deleted = 0;
    const failures: string[] = [];
    for (const post of posts) {
      const res = await deletePostCancellingZernio(supabase, post.id, brand.id, user?.id);
      if (res.ok) deleted++;
      else failures.push(res.message);
    }
    if (failures.length) {
      return fail(502, {
        error: `${failures.length} post(s) NOT deleted — ${failures[0]}`,
        deletedSelected: deleted
      });
    }
    return { deletedSelected: deleted };
  },

  /** Bulk-publish selected blog articles (calendar multi-select). */
  publishSelectedArticles: async ({ request, params, locals: { supabase } }) => {
    const ids = parseIds(await request.formData());
    if (!ids.length) return fail(400, { error: 'No articles selected' });
    const { data: brand } = await supabase
      .from('brands')
      .select('id')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand) return fail(404, { error: 'Brand not found' });
    const admin = createAdminClient();
    const { data: arts } = await admin
      .from('brand_articles')
      .select('id')
      .eq('brand_id', brand.id)
      .in('id', ids)
      .neq('status', 'published')
      .neq('status', 'planned');
    const publishIds = (arts ?? []).map((a) => a.id);
    if (!publishIds.length) return { publishedSelected: 0 };
    const { error } = await admin
      .from('brand_articles')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('brand_id', brand.id)
      .in('id', publishIds);
    if (error) return fail(500, { error: error.message });
    const { syncArticlesToCMS } = await import('$lib/server/cms-sync');
    const cms = await syncArticlesToCMS(admin, brand.id, publishIds);
    return { publishedSelected: publishIds.length, cms };
  },

  /** Bulk-delete selected blog articles. */
  deleteSelectedArticles: async ({ request, params, locals: { supabase } }) => {
    const ids = parseIds(await request.formData());
    if (!ids.length) return fail(400, { error: 'No articles selected' });
    const { data: brand } = await supabase
      .from('brands')
      .select('id')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand) return fail(404, { error: 'Brand not found' });
    const admin = createAdminClient();
    const { error } = await admin
      .from('brand_articles')
      .delete()
      .eq('brand_id', brand.id)
      .in('id', ids);
    if (error) return fail(500, { error: error.message });
    return { deletedSelectedArticles: ids.length };
  },


  approveAll: async ({ params, locals: { supabase, user } }) => {
    const { data: brand } = await supabase
      .from('brands')
      .select('id, timezone')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand) return {};
    const { data: pending } = await supabase
      .from('posts')
      .select(EDITOR_POST_COLS)
      .eq('brand_id', brand.id)
      .eq('status', 'pending_user');
    let noAccount = false;
    for (const post of pending ?? []) {
      const res = await publishApprovedPost(
        supabase,
        post as ApprovablePost,
        brand.timezone ?? 'Europe/Rome',
        { by: user?.id }
      );
      if (res.noAccount) noAccount = true;
    }
    return { ok: true, noAccount };
  },

  emailApprove: async ({ params, url, locals: { supabase, safeGetSession, locale } }) => {
    const { session, user } = await safeGetSession();
    if (!session || !user?.email) return fail(400, { error: 'No email on file' });
    const { data: brand } = await supabase
      .from('brands')
      .select('id, name')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand) return fail(404, { error: 'Brand not found' });
    const { data: pending } = await supabase
      .from('posts')
      .select('platform, caption, media_url')
      .eq('brand_id', brand.id)
      .eq('status', 'pending_user')
      .order('created_at', { ascending: true });
    if (!pending || pending.length === 0) return { emailed: false, empty: true };
    const token = signApproveToken(brand.id);
    const approveUrl = `${url.origin}/approve/${token}`;
    try {
      await sendEmail({
        to: user.email,
        subject: approvalEmailSubject(locale, brand.name, pending.length),
        html: approvalEmailHtml(locale, brand.name, pending.length, approveUrl, pending, url.origin),
        text: approvalEmailText(locale, brand.name, pending.length, approveUrl, pending)
      });
    } catch (e) {
      return fail(500, { error: e instanceof Error ? e.message : 'Email failed' });
    }
    return { emailed: true, to: user.email };
  },

  ...editorActions
};
