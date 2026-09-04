import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { dayInZone, type CalendarPost } from './calendar-month';

type Calendar = {
  posts: CalendarPost[];
  year: number;
  month: number;
  monthLabel: string;
  prevYM: string;
  nextYM: string;
  timezone: string;
};

type ApproveResult = {
  ok?: boolean;
  status?: string;
  noAccount?: boolean;
  message?: string;
  error?: string;
};

type Outcome = {
  id: string | null;
  message: string | null;
  saved: boolean;
  approved: boolean;
  status: string | null;
};

const MONTH_PARAM = /^\d{4}-\d{2}$/;
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

export const load: PageServerLoad = async ({ params, url, fetch, locals }) => {
  const { session } = await locals.safeGetSession();
  if (!session) {
    redirect(303, '/login');
  }

  const month = url.searchParams.get('month');
  const query = month && MONTH_PARAM.test(month) ? `?month=${month}` : '';

  const res = await fetch(brandApi(params.brand, `/calendar${query}`), {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });

  if (!res.ok) {
    error(res.status, await readError(res));
  }

  const calendar = (await res.json()) as Calendar;

  return {
    brand: params.brand,
    calendar,
    today: dayInZone(new Date().toISOString(), calendar.timezone),
    selectedPostId: url.searchParams.get('post')
  };
};

export const actions: Actions = {
  edit: async ({ request, params, fetch, locals }) => {
    const { session } = await locals.safeGetSession();
    if (!session) {
      redirect(303, '/login');
    }

    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const caption = String(form.get('caption') ?? '');

    if (!id) {
      return fail(400, outcome({ message: 'Missing post.' }));
    }
    if (!caption.trim()) {
      return fail(400, outcome({ id, message: 'The copy cannot be empty.' }));
    }
    if (caption.length > CAPTION_MAX) {
      return fail(400, outcome({ id, message: 'The copy is too long to save.' }));
    }

    const res = await fetch(brandApi(params.brand, `/posts/${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ caption })
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
