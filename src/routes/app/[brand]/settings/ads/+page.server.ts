import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { adsAvailable, adsFeatureEnabled, parseAdsSettings } from '$lib/server/ads';

export const load: PageServerLoad = async ({ parent, locals: { safeGetSession } }) => {
  const { brand } = await parent();
  const { user } = await safeGetSession();
  if (!adsFeatureEnabled(user?.email)) throw error(404, 'Not found');
  return {
    adsEnabled: adsAvailable(brand.plan, user?.email),
    settings: parseAdsSettings(brand.ads_settings)
  };
};

export const actions: Actions = {
  saveSettings: async ({ request, locals: { supabase, safeGetSession }, params }) => {
    const { user } = await safeGetSession();
    const { data: brand } = await supabase
      .from('brands')
      .select('id, plan, ads_settings')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand) return fail(404, { error: 'Brand not found' });
    if (!adsAvailable(brand.plan, user?.email)) return fail(403, { error: 'Ads requires Pro' });

    const fd = await request.formData();
    // Blank clears the cap. Falling back to the previous value made a cap impossible to remove
    // once set — and these are optional ceilings, not the campaign budget.
    const cap = (v: FormDataEntryValue | null) => {
      const s = String(v ?? '').trim();
      if (!s) return undefined;
      const n = Number(s);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const countriesRaw = String(fd.get('defaultCountries') ?? '');
    const currency = String(fd.get('defaultCurrency') ?? 'EUR').slice(0, 8);
    const dsaBeneficiary = String(fd.get('dsaBeneficiary') ?? '').slice(0, 100);
    const dsaPayor = String(fd.get('dsaPayor') ?? '').slice(0, 100);

    const countries = countriesRaw
      .split(/[,\s]+/)
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c));

    const prev = parseAdsSettings(brand.ads_settings);
    const next = {
      ...prev,
      dailyBudgetCap: cap(fd.get('dailyBudgetCap')),
      monthlyBudgetCap: cap(fd.get('monthlyBudgetCap')),
      defaultCountries: countries.length ? countries : prev.defaultCountries,
      defaultCurrency: currency || prev.defaultCurrency || 'EUR',
      dsaBeneficiary: dsaBeneficiary || undefined,
      dsaPayor: dsaPayor || undefined
    };

    const { error: upErr } = await supabase.from('brands').update({ ads_settings: next }).eq('id', brand.id);
    if (upErr) return fail(500, { error: upErr.message });
    return { saved: true };
  }
};
