import type { LayoutServerLoad } from './$types';

/** Legacy /studio/* redirects to /settings/* — no deferred data needed. */
export const load: LayoutServerLoad = async () => ({});
