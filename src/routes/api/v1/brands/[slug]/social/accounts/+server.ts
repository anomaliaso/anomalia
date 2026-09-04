import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { appOrigin } from '$lib/server/app-url';
import { managePath, socialConnections } from '$lib/server/social-connections';
import { TARGET_PLATFORMS } from '@anomalia/api-contracts';

/**
 * Su cosa questo brand pubblica davvero. `get_brand_settings` porta lo stesso elenco di
 * `connected_platforms` — dalla stessa lettura, quindi non possono divergere — ma solo qui si vede
 * l'account: l'handle, e se ha smesso di funzionare. Un account scaduto è la ragione per cui un
 * post programmato non esce, ed è invisibile a chiunque guardi solo le piattaforme bersaglio.
 *
 * Non passa di qui nessun token: la riga in `social_accounts` non ne contiene, le credenziali
 * stanno da Zernio, e l'id Zernio dell'account non esce perché non serve a niente che un agente
 * possa fare.
 */
export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const state = await socialConnections(supabase, brand);

  return json({
    brand: brand.slug,
    accounts: state.accounts,
    connected_platforms: state.connected,
    broken_platforms: state.broken,
    platform_choices: [...TARGET_PLATFORMS],
    can_connect: state.canConnect,
    slots: state.slots,
    manage_url: `${appOrigin(url)}${managePath(brand.slug)}`
  });
};
