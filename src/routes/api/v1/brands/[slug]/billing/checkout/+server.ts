import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, checkApiKeyWriteAccess, loadBrandForUser } from '$lib/server/cli-auth';
import { billingLink } from '$lib/server/billing-links';
import { isOrgOwner, orgBillingForBrand } from '$lib/server/org-billing';
import { plansAbove } from '$lib/server/plans';
import { appOrigin } from '$lib/server/app-url';
import { CHECKOUT_LINK, statusForFailure } from '@anomalia/api-contracts';

/**
 * The plan is named nowhere but here: the hosted page carries the prices, so this endpoint only
 * checks that the plan asked for is one the org can move up to and returns the same ladder the
 * web upgrade button offers. Like the portal link, the URL is returned once and stored nowhere.
 */
export const POST: RequestHandler = async ({ request, params, url }) => {
  const { supabase, user, apiKey, error } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const readOnly = checkApiKeyWriteAccess(apiKey);
  if (readOnly) return readOnly;

  const parsed = CHECKOUT_LINK.input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const appBillingUrl = `${appOrigin(url)}/app/billing`;

  if (!(await isOrgOwner(supabase, brand.org_id, user.id))) {
    return json(
      { error: 'not_org_owner' },
      { status: statusForFailure(CHECKOUT_LINK, 'not_org_owner') }
    );
  }

  const billing = await orgBillingForBrand(supabase, { slug: params.slug });
  const plans = plansAbove(billing?.plan).map((p) => ({ key: p.key, label: p.label }));

  const wanted = parsed.data.plan;
  if (wanted && !plans.some((p) => p.key === wanted)) {
    return json(
      { error: 'unknown_plan', plans },
      { status: statusForFailure(CHECKOUT_LINK, 'unknown_plan') }
    );
  }

  const link = await billingLink(supabase, {
    slug: params.slug,
    returnUrl: appBillingUrl,
    flow: 'upgrade'
  });
  if (link.refusal) {
    return json(
      { error: link.refusal, message: link.message || undefined, app_billing_url: appBillingUrl },
      { status: statusForFailure(CHECKOUT_LINK, link.refusal) }
    );
  }

  return json({ ok: true, url: link.url, plans });
};
