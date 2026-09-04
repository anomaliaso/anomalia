import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, fetch, locals }) => {
  const { session } = await locals.safeGetSession();
  if (!session) {
    redirect(303, '/login');
  }

  const res = await fetch(`/api/v1/brands/${encodeURIComponent(params.brand)}`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    error(res.status, body?.error ?? `Request failed (${res.status})`);
  }

  const read = (await res.json()) as { brand: { name: string }; pendingCount: number };

  return { slug: params.brand, brandName: read.brand.name, pendingCount: read.pendingCount };
};
