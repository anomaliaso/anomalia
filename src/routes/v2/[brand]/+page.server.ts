import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { PostRow } from './post-state';
import { todos, upcoming, type DashboardFacts } from './dashboard';

type SchedulerRun = { status: string; error: string | null };

type BrandRead = {
  brand: { name: string; slug: string; timezone: string };
  pendingCount: number;
  scheduledCount: number;
  publishedCount: number;
  accountCount: number;
  plan: { id: string } | null;
  runs: SchedulerRun[];
};

type ShareRow = {
  id: string;
  view: string;
  status: string;
  created_at: string;
  expires_at: string | null;
};

type ShareOutcome = { url: string | null; message: string | null; revoked: boolean };

const SHARE_VIEW = 'dashboard';

function outcome(partial: Partial<ShareOutcome>): ShareOutcome {
  return { url: null, message: null, revoked: false, ...partial };
}

function brandApi(slug: string, path: string): string {
  return `/api/v1/brands/${encodeURIComponent(slug)}${path}`;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed (${res.status})`;
}

async function bearer(locals: App.Locals): Promise<Record<string, string>> {
  const { session } = await locals.safeGetSession();
  if (!session) {
    redirect(303, '/login');
  }

  return { Authorization: `Bearer ${session.access_token}` };
}

export const load: PageServerLoad = async ({ params, fetch, locals }) => {
  const headers = await bearer(locals);

  const [brandRes, postsRes, sharesRes] = await Promise.all([
    fetch(brandApi(params.brand, ''), { headers }),
    fetch(brandApi(params.brand, '/posts?status=all'), { headers }),
    fetch(brandApi(params.brand, '/shares'), { headers })
  ]);

  if (!brandRes.ok) {
    error(brandRes.status, await readError(brandRes));
  }
  if (!postsRes.ok) {
    error(postsRes.status, await readError(postsRes));
  }

  const read = (await brandRes.json()) as BrandRead;
  const posts = (await postsRes.json()) as PostRow[];

  // Una share illeggibile non deve portarsi via la dashboard: la migration può non essere ancora
  // applicata, e il link al cliente è un di più rispetto a quello che la pagina esiste per dire.
  const shares = sharesRes.ok
    ? ((await sharesRes.json()) as { shares?: ShareRow[] }).shares ?? []
    : [];

  const facts: DashboardFacts = {
    pending: read.pendingCount,
    scheduled: read.scheduledCount,
    published: read.publishedCount,
    accounts: read.accountCount,
    hasEditorialPlan: Boolean(read.plan),
    lastRunError: read.runs[0]?.error ?? null
  };

  return {
    slug: params.brand,
    brand: read.brand,
    facts,
    todos: todos(facts, params.brand),
    upcoming: upcoming(posts, read.brand.timezone),
    liveShares: shares.filter((s) => s.view === SHARE_VIEW && s.status === 'live')
  };
};

export const actions: Actions = {
  share: async ({ params, fetch, locals }) => {
    const headers = await bearer(locals);

    const res = await fetch(brandApi(params.brand, '/shares'), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ view: SHARE_VIEW })
    });

    if (!res.ok) {
      return fail(res.status, outcome({ message: await readError(res) }));
    }

    const created = (await res.json()) as { url: string };
    return outcome({ url: created.url });
  },

  revoke: async ({ request, params, fetch, locals }) => {
    const headers = await bearer(locals);
    const id = String((await request.formData()).get('id') ?? '');

    if (!id) {
      return fail(400, outcome({ message: 'Missing link.' }));
    }

    const res = await fetch(brandApi(params.brand, '/shares/revoke'), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });

    if (!res.ok) {
      return fail(res.status, outcome({ message: await readError(res) }));
    }

    return outcome({ revoked: true });
  }
};
