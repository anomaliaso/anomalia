import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { dayInZone } from './calendar-month';
import { filterFor, viewFor, type PostDetail, type PostRow } from '../post-state';

type Surface = {
  heading: string;
  timezone: string;
  posts: PostRow[];
  month: { year: number; month: number; prevYM: string; nextYM: string } | null;
};

type ApproveResult = { status?: string; message?: string; error?: string };

type Outcome = {
  id: string | null;
  message: string | null;
  saved: boolean;
  approved: boolean;
  status: string | null;
};

const MONTH_PARAM = /^\d{4}-\d{2}$/;
const PLATFORM_CAPTION = /^caption_(.+)$/;
const CAPTION_MAX = 20_000;

function outcome(partial: Partial<Outcome>): Outcome {
  return { id: null, message: null, saved: false, approved: false, status: null, ...partial };
}

function brandApi(slug: string, path: string): string {
  return `/api/v1/brands/${encodeURIComponent(slug)}${path}`;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed (${res.status})`;
}

type Reader = { fetch: typeof fetch; headers: Record<string, string>; slug: string };

async function readMonth(r: Reader, monthParam: string | null): Promise<Surface> {
  const query = monthParam && MONTH_PARAM.test(monthParam) ? `?month=${monthParam}` : '';
  const res = await r.fetch(brandApi(r.slug, `/calendar${query}`), { headers: r.headers });
  if (!res.ok) {
    error(res.status, await readError(res));
  }

  const calendar = (await res.json()) as {
    posts: PostRow[];
    year: number;
    month: number;
    monthLabel: string;
    prevYM: string;
    nextYM: string;
    timezone: string;
  };

  return {
    heading: calendar.monthLabel,
    timezone: calendar.timezone,
    posts: calendar.posts,
    month: {
      year: calendar.year,
      month: calendar.month,
      prevYM: calendar.prevYM,
      nextYM: calendar.nextYM
    }
  };
}

async function readList(r: Reader, status: string): Promise<Surface> {
  const [brandRes, postsRes] = await Promise.all([
    r.fetch(brandApi(r.slug, ''), { headers: r.headers }),
    r.fetch(brandApi(r.slug, `/posts?status=${status}`), { headers: r.headers })
  ]);

  if (!brandRes.ok) {
    error(brandRes.status, await readError(brandRes));
  }
  if (!postsRes.ok) {
    error(postsRes.status, await readError(postsRes));
  }

  const { brand } = (await brandRes.json()) as { brand: { name: string; timezone: string } };

  return {
    heading: brand.name,
    timezone: brand.timezone,
    posts: (await postsRes.json()) as PostRow[],
    month: null
  };
}

async function readDetail(r: Reader, id: string): Promise<PostDetail | null> {
  const res = await r.fetch(brandApi(r.slug, `/posts/${encodeURIComponent(id)}/media`), {
    headers: r.headers
  });
  if (!res.ok) {
    return null;
  }

  const detail = (await res.json()) as PostDetail & { error?: string };
  return detail.error ? null : detail;
}

export const load: PageServerLoad = async ({ params, url, fetch, locals }) => {
  const { session } = await locals.safeGetSession();
  if (!session) {
    redirect(303, '/login');
  }

  const reader: Reader = {
    fetch,
    headers: { Authorization: `Bearer ${session.access_token}` },
    slug: params.brand
  };

  const view = viewFor(url.searchParams.get('view'));
  const status = filterFor(url.searchParams.get('status'));
  const selectedId = url.searchParams.get('post');

  const surface =
    view === 'list' ? await readList(reader, status) : await readMonth(reader, url.searchParams.get('month'));

  return {
    brand: params.brand,
    view,
    status,
    ...surface,
    today: dayInZone(new Date().toISOString(), surface.timezone),
    selectedId,
    detail: selectedId ? await readDetail(reader, selectedId) : null
  };
};

function captionPatch(form: FormData): Record<string, unknown> | string {
  const caption = String(form.get('caption') ?? '');
  if (!caption.trim()) {
    return 'The copy cannot be empty.';
  }
  if (caption.length > CAPTION_MAX) {
    return 'The copy is too long to save.';
  }

  const overrides: Record<string, string> = {};
  let sawOverride = false;

  for (const [key, value] of form.entries()) {
    const platform = PLATFORM_CAPTION.exec(key)?.[1];
    if (!platform || typeof value !== 'string') {
      continue;
    }
    if (value.length > CAPTION_MAX) {
      return `The copy for ${platform} is too long to save.`;
    }

    sawOverride = true;
    if (value.trim()) {
      overrides[platform] = value.trim();
    }
  }

  if (!sawOverride) {
    return { caption };
  }

  return { caption, platform_captions: Object.keys(overrides).length ? overrides : null };
}

export const actions: Actions = {
  edit: async ({ request, params, fetch, locals }) => {
    const { session } = await locals.safeGetSession();
    if (!session) {
      redirect(303, '/login');
    }

    const form = await request.formData();
    const id = String(form.get('id') ?? '');

    if (!id) {
      return fail(400, outcome({ message: 'Missing post.' }));
    }

    const patch = captionPatch(form);
    if (typeof patch === 'string') {
      return fail(400, outcome({ id, message: patch }));
    }

    const res = await fetch(brandApi(params.brand, `/posts/${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(patch)
    });

    if (!res.ok) {
      return fail(res.status, outcome({ id, message: await readError(res) }));
    }

    return outcome({ id, saved: true });
  },

  approve: async ({ request, params, fetch, locals }) => {
    const { session } = await locals.safeGetSession();
    if (!session) {
      redirect(303, '/login');
    }

    const form = await request.formData();
    const id = String(form.get('id') ?? '');

    if (!id) {
      return fail(400, outcome({ message: 'Missing post.' }));
    }

    const res = await fetch(brandApi(params.brand, `/posts/${encodeURIComponent(id)}/approve`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` }
    });

    const result = (await res.json().catch(() => null)) as ApproveResult | null;

    if (!res.ok || result?.error) {
      return fail(
        res.ok ? 400 : res.status,
        outcome({ id, message: result?.error ?? 'Approval failed.' })
      );
    }

    return outcome({
      id,
      approved: true,
      status: result?.status ?? 'approved',
      message: result?.message ?? null
    });
  }
};
