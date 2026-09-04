import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listOf, type PlanBlob } from './plan-shape';

type BrandRead = {
  brand: { name: string; slug: string; timezone: string };
};

type PlanRead = {
  plan: PlanBlob | null;
  proposed: PlanBlob | null;
  proposedFeedback: string | null;
  currentWeek: number | null;
  quota: { used: number; remaining: number };
};

type StudioRead = {
  kit: PlanBlob | null;
  products: unknown[];
  documents: unknown[];
  people: unknown[];
  competitors: unknown[];
  targetPlatforms: string[];
  language: string;
  studioPct: number;
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

  const [brandRes, planRes, studioRes] = await Promise.all([
    fetch(brandApi(params.brand, ''), { headers }),
    fetch(brandApi(params.brand, '/editorial-plan'), { headers }),
    fetch(brandApi(params.brand, '/studio'), { headers })
  ]);

  if (!brandRes.ok) {
    error(brandRes.status, await readError(brandRes));
  }
  if (!planRes.ok) {
    error(planRes.status, await readError(planRes));
  }
  if (!studioRes.ok) {
    error(studioRes.status, await readError(studioRes));
  }

  const { brand } = (await brandRes.json()) as BrandRead;
  const editorial = (await planRes.json()) as PlanRead;
  const studio = (await studioRes.json()) as StudioRead;

  return {
    brand: { slug: params.brand, name: brand.name },
    plan: editorial.plan,
    proposed: editorial.proposed,
    proposedFeedback: editorial.proposedFeedback,
    currentWeek: editorial.currentWeek,
    quota: editorial.quota,
    truth: {
      pillars: listOf(studio.kit, 'content_pillars'),
      platforms: studio.targetPlatforms,
      language: studio.language,
      completeness: studio.studioPct,
      products: studio.products.length,
      people: studio.people.length,
      competitors: studio.competitors.length,
      documents: studio.documents.length
    }
  };
};
