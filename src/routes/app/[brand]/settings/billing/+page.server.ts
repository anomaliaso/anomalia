import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Billing belongs to the organization, not to one of its brands: the page and its actions moved
// to /app/billing. This route stays only to carry the links already out there — the settings nav,
// UpgradeLink, the provider's upgradeUrl, and whatever anyone bookmarked.
export const load: PageServerLoad = async () => {
  throw redirect(308, '/app/billing');
};
