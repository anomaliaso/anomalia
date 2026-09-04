import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const CARRIED = ['status', 'post'] as const;

export const GET: RequestHandler = ({ params, url }) => {
  const to = new URL(`/v2/${params.brand}/calendar`, url);
  to.searchParams.set('view', 'list');

  for (const key of CARRIED) {
    const value = url.searchParams.get(key);
    if (value) {
      to.searchParams.set(key, value);
    }
  }

  redirect(302, `${to.pathname}${to.search}`);
};
