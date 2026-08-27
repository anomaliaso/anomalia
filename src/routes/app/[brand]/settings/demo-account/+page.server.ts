import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { isBrowserlessConfigured } from '$lib/server/browserless';
import {
  clearDemoAccount,
  harvestProductUi,
  loadDemoAccountPublic,
  saveDemoAccount
} from '$lib/server/demo-account';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~180s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 180 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
  const { brand } = await parent();
  let admin: ReturnType<typeof createAdminClient> | undefined;
  try {
    admin = createAdminClient();
  } catch {
    admin = undefined;
  }
  const demo = await loadDemoAccountPublic(supabase, brand.id, admin);
  return {
    demo,
    captureReady: isBrowserlessConfigured()
  };
};

export const actions: Actions = {
  save: async ({ request, params, locals: { supabase } }) => {
    const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
    if (!brand) return fail(404, { error: 'Brand not found' });
    const fd = await request.formData();
    const loginUrl = String(fd.get('login_url') ?? '');
    const username = String(fd.get('username') ?? '');
    const password = String(fd.get('password') ?? '');
    const pagesText = String(fd.get('pages') ?? '');
    try {
      const admin = createAdminClient();
      const saved = await saveDemoAccount(supabase, admin, brand.id, {
        loginUrl,
        username,
        pages: pagesText.split(/\r?\n/),
        instructions: String(fd.get('instructions') ?? ''),
        password: password.trim() || undefined,
        emailSelector: String(fd.get('email_selector') ?? '') || null,
        passwordSelector: String(fd.get('password_selector') ?? '') || null,
        submitSelector: String(fd.get('submit_selector') ?? '') || null,
        successSelector: String(fd.get('success_selector') ?? '') || null
      });
      if (!saved.ok) return fail(400, { error: saved.error });
      return { saved: true };
    } catch (e) {
      return fail(500, { error: e instanceof Error ? e.message : 'save_failed' });
    }
  },

  clear: async ({ params, locals: { supabase } }) => {
    const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
    if (!brand) return fail(404, { error: 'Brand not found' });
    try {
      const admin = createAdminClient();
      const cleared = await clearDemoAccount(supabase, admin, brand.id);
      if (!cleared.ok) return fail(500, { error: cleared.error });
      return { cleared: true };
    } catch (e) {
      return fail(500, { error: e instanceof Error ? e.message : 'clear_failed' });
    }
  },

  harvest: async ({ params, locals: { supabase } }) => {
    const { data: brand } = await supabase.from('brands').select('id').eq('slug', params.brand).maybeSingle();
    if (!brand) return fail(404, { error: 'Brand not found' });
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return fail(401, { error: 'unauthorized' });
    try {
      const admin = createAdminClient();
      const result = await harvestProductUi({
        supabase,
        admin,
        brandId: brand.id,
        userId: user.id,
        discover: true
      });
      if (!result.ok) return fail(400, { error: result.error });
      return {
        harvested: true,
        count: result.captured.filter((c) => c.ok).length,
        failed: result.captured.filter((c) => !c.ok).length,
        discovered: result.discovered
      };
    } catch (e) {
      return fail(500, { error: e instanceof Error ? e.message : 'harvest_failed' });
    }
  }
};
