import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Legacy onboarding_jobs status poller — retired with the background pipeline.
export const GET: RequestHandler = async () => {
  return json({ found: false, disabled: true }, { status: 410 });
};
