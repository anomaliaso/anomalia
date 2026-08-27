import { redirect } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';

// The bare path is the canonical English URL, so an explicit /en prefix is duplicate
// content — bounce it to the unprefixed path. /it (and the bare path) pass through.
export const load: LayoutLoad = async ({ params, url }) => {
  if (params.lang === 'en') {
    const stripped = url.pathname.replace(/^\/en(?=\/|$)/, '') || '/';
    throw redirect(308, stripped + url.search);
  }
};
