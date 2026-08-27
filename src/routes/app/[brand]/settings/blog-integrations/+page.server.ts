import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { hasBlogIntegrations, hasBlogCustomDomain } from '$lib/server/plans';
import {
  loadBlogSettingsData,
  connectShopify,
  saveShopifyBlog,
  toggleShopify,
  disconnectShopify,
  connectWebflow,
  saveWebflowCollection,
  toggleWebflow,
  disconnectWebflow,
  connectWix,
  saveWix,
  toggleWix,
  disconnectWix
} from '$lib/server/blog-settings';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~60s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 60 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const load: PageServerLoad = async ({ parent, url, locals: { supabase } }) => {
  const { brand } = await parent();
  // Free/Go = Anomalia blog hosting only — CMS sync is Starter+.
  // Free without custom domain → activate; Go → domain settings (paid hosting perk).
  if (!hasBlogIntegrations(brand.plan)) {
    if (!hasBlogCustomDomain(brand.plan)) {
      throw redirect(303, `/app/${brand.slug}/activate?plan=starter`);
    }
    throw redirect(303, `/app/${brand.slug}/settings/blog-domain`);
  }
  return loadBlogSettingsData(brand, url, supabase);
};

export const actions: Actions = {
  connectShopify,
  saveShopifyBlog,
  toggleShopify,
  disconnectShopify,
  connectWebflow,
  saveWebflowCollection,
  toggleWebflow,
  disconnectWebflow,
  connectWix,
  saveWix,
  toggleWix,
  disconnectWix
};
