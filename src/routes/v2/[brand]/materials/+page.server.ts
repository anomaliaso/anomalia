import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { kindFor, ofKind, type MediaRow } from './media-kind';

type BrandRead = {
  brand: { name: string; slug: string; timezone: string };
};

const QUERY_MAX = 200;

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

  const headers = { Authorization: `Bearer ${session.access_token}` };
  const kind = kindFor(url.searchParams.get('kind'));
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, QUERY_MAX);
  const search = query ? `?query=${encodeURIComponent(query)}` : '';

  const [brandRes, mediaRes] = await Promise.all([
    fetch(brandApi(params.brand, ''), { headers }),
    fetch(brandApi(params.brand, `/media${search}`), { headers })
  ]);

  if (!brandRes.ok) {
    error(brandRes.status, await readError(brandRes));
  }
  if (!mediaRes.ok) {
    error(mediaRes.status, await readError(mediaRes));
  }

  const { brand } = (await brandRes.json()) as BrandRead;
  const { media } = (await mediaRes.json()) as { media: MediaRow[] };

  return {
    brand: { slug: params.brand, name: brand.name, timezone: brand.timezone },
    kind,
    query,
    media: ofKind(media, kind),
    selectedMediaId: url.searchParams.get('item')
  };
};
