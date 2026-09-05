import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { currencyForCountry } from '$lib/plans';
import { isPlanGoEnabled } from '$lib/server/feature-flags';
import { createCheckoutSession, ensureBrandCustomer, geoCouponFor, priceFor } from '$lib/server/stripe';

/**
 * IL PAYWALL: l'unico posto da cui parte il primo abbonamento. Ogni altra superficie che parla di
 * pagare — i redirect delle impostazioni, le CTA "collega i social", i prompt degli agenti —
 * atterra qui, e chi non ha ancora un abbonamento non ha nessun altro modo di aprirne uno: il
 * portale Stripe cambia un abbonamento, non ne crea il primo.
 *
 * Dopo il checkout Stripe rimanda su `?status=processing`, la pagina ricarica ogni pochi secondi e
 * il brand diventa attivo per il trigger della 0007 sulla sottoscrizione: da lì questo load
 * rimanda a /success. Nessun webhook nostro nel mezzo.
 */
export const load: PageServerLoad = async ({ parent, locals: { supabase } }) => {
  const { brand } = await parent();

  if (brand.status === 'active') {
    throw redirect(303, brand.launched_at ? `/app/${brand.slug}` : `/app/${brand.slug}/success`);
  }

  // Quanti post aspettano già di essere pubblicati: è l'incentivo concreto del paywall.
  const { count } = await supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brand.id);

  return { readyPosts: count ?? 0 };
};

export const actions: Actions = {
  checkout: async ({ request, params, url, locals: { supabase } }) => {
    const data = await request.formData();
    const plan = String(data.get('plan') ?? 'pro');
    // Go si vende solo mentre FEATURE_PLAN_GO è acceso: un checkout costruito a mano non lo aggira.
    if (plan === 'go' && !isPlanGoEnabled()) return fail(400, { error: 'Unknown plan' });

    const cycle = String(data.get('cycle') ?? 'month') === 'year' ? 'year' : 'month';
    const country = request.headers.get('x-vercel-ip-country');
    const priceId = priceFor(plan, cycle, currencyForCountry(country));
    if (!priceId) return fail(400, { error: 'Unknown plan' });

    const { data: brand } = await supabase
      .from('brands')
      .select('id, name, slug, stripe_customer_id')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand) throw redirect(303, '/app');

    const checkoutUrl = await createCheckoutSession({
      customerId: await ensureBrandCustomer(brand),
      brandId: brand.id,
      plan,
      priceId,
      couponId: geoCouponFor(country),
      successUrl: `${url.origin}/app/${brand.slug}/activate?status=processing`,
      cancelUrl: `${url.origin}/app/${brand.slug}/activate`
    });

    throw redirect(303, checkoutUrl);
  }
};
