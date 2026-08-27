import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Legacy "we're generating your strategy" screen for onboarding_jobs — retired.
export const load: PageServerLoad = async () => {
  throw redirect(303, '/app');
};
