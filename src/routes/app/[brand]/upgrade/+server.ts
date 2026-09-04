import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { orgBillingForBrand } from '$lib/server/org-billing';
import { plansAbove } from '$lib/server/plans';

/**
 * GET /app/{brand}/upgrade?plan=pro — un LINK, e un click su un link è navigazione, non consenso a
 * pagare: qui dentro non si apre nessuna sessione Stripe. Instrada e basta, verso la superficie
 * che la decisione può prenderla davvero.
 *
 *   org senza abbonamento  →  /activate?plan=…   (il checkout: l'abbonamento non esiste ancora)
 *   org che già paga       →  /app/billing       (il portale Stripe, con la scala dei piani)
 *
 * Un `?plan` che non sta sopra il piano attuale viene lasciato cadere invece di rifiutato: chi ha
 * cliccato voleva comunque salire, e il paywall gli mostra tutta la scala.
 */
export const GET: RequestHandler = async ({ params, url, locals: { supabase, safeGetSession } }) => {
  const { session } = await safeGetSession();
  if (!session) throw redirect(303, '/login');
  if (!(await canEnter(supabase))) throw redirect(303, '/waitlist');

  const billing = await orgBillingForBrand(supabase, { slug: params.brand });
  if (!billing) throw redirect(303, '/app');

  if (billing.subscriptionId) throw redirect(303, '/app/billing');

  const plan = (url.searchParams.get('plan') ?? '').toLowerCase();
  const offered = plansAbove(billing.plan).some((p) => p.key === plan);

  throw redirect(303, `/app/${params.brand}/activate${offered ? `?plan=${encodeURIComponent(plan)}` : ''}`);
};
