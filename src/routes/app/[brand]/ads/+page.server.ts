import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The Ads hub is split per channel (Social / Google). /ads keeps working for old links, emails and
// the Settings shortcut by landing on the social channel.
export const load: PageServerLoad = async ({ params }) => {
  throw redirect(307, `/app/${params.brand}/ads/social`);
};
