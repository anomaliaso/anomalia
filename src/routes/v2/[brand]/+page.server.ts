import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { nextOut, type ScheduledPost } from './overview';

type SchedulerRun = {
  status: string;
  posts_created: number | null;
  created_at: string;
  error: string | null;
};

type BrandRead = {
  brand: { name: string; slug: string; status: string; plan: string | null; timezone: string };
  pendingCount: number;
  scheduledCount: number;
  publishedCount: number;
  accountCount: number;
  plan: { id: string } | null;
  runs: SchedulerRun[];
};

function brandApi(slug: string, path: string): string {
  return `/api/v1/brands/${encodeURIComponent(slug)}${path}`;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed (${res.status})`;
}

export const load: PageServerLoad = async ({ params, fetch, locals }) => {
  const { session } = await locals.safeGetSession();
  if (!session) {
    redirect(303, '/login');
  }

  const headers = { Authorization: `Bearer ${session.access_token}` };

  const [brandRes, scheduledRes] = await Promise.all([
    fetch(brandApi(params.brand, ''), { headers }),
    fetch(brandApi(params.brand, '/posts?status=scheduled'), { headers })
  ]);

  if (!brandRes.ok) {
    error(brandRes.status, await readError(brandRes));
  }
  if (!scheduledRes.ok) {
    error(scheduledRes.status, await readError(scheduledRes));
  }

  const read = (await brandRes.json()) as BrandRead;
  const scheduled = (await scheduledRes.json()) as ScheduledPost[];

  return {
    slug: params.brand,
    brand: read.brand,
    counts: {
      pending: read.pendingCount,
      scheduled: read.scheduledCount,
      published: read.publishedCount,
      accounts: read.accountCount
    },
    hasEditorialPlan: Boolean(read.plan),
    lastRun: read.runs[0] ?? null,
    next: nextOut(scheduled)
  };
};
