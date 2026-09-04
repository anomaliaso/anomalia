import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, checkApiKeyWriteAccess, loadBrandForUser } from '$lib/server/cli-auth';
import { appOrigin } from '$lib/server/app-url';
import { connectPath, managePath, socialConnections } from '$lib/server/social-connections';
import { SOCIAL_CONNECT_LINK, TARGET_PLATFORMS, statusForFailure } from '@anomalia/api-contracts';

/**
 * Conia la porta, non la attraversa.
 *
 * L'URL è la nostra pagina `/settings/connect/:platform`, che chiede la login della persona e da
 * lì manda all'OAuth della piattaforma. È deliberatamente quella e non l'URL OAuth di Zernio:
 * quello va coniato creando il profilo Zernio del brand, scade, si usa una volta sola, e porta un
 * token nell'indirizzo — tre buoni motivi perché non passi mai da un agente. Così invece il
 * consenso lo dà una persona già dentro, e qui non transita nessun segreto.
 *
 * I due rifiuti sono separati di proposito: un piano che non collega account e un piano pieno
 * chiedono due rimedi diversi, e un solo errore generico li avrebbe confusi.
 */
export const POST: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const readOnly = checkApiKeyWriteAccess(apiKey);
  if (readOnly) return readOnly;

  const parsed = SOCIAL_CONNECT_LINK.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_input',
        details: parsed.error.issues,
        platform_choices: [...TARGET_PLATFORMS]
      },
      { status: 400 }
    );
  }

  const { platform } = parsed.data;
  const origin = appOrigin(url);
  const manageUrl = `${origin}${managePath(brand.slug)}`;
  const state = await socialConnections(supabase, brand);

  if (!state.canConnect) {
    return json(
      {
        error: 'plan_cannot_connect',
        plan: brand.plan,
        brand_status: brand.status,
        activate_url: `${origin}/app/${encodeURIComponent(brand.slug)}/activate`
      },
      { status: statusForFailure(SOCIAL_CONNECT_LINK, 'plan_cannot_connect') }
    );
  }

  const alreadyConnected = state.connected.includes(platform);

  // Un posto pieno blocca una piattaforma NUOVA. Riautorizzarne una già collegata no: il posto è
  // già suo, e rifiutarlo lascerebbe un account scaduto senza modo di tornare vivo.
  if (!alreadyConnected && state.slots.used >= state.slots.limit) {
    return json(
      { error: 'account_limit', slots: state.slots, manage_url: manageUrl },
      { status: statusForFailure(SOCIAL_CONNECT_LINK, 'account_limit') }
    );
  }

  return json({
    ok: true,
    platform,
    url: `${origin}${connectPath(brand.slug, platform)}`,
    already_connected: alreadyConnected,
    slots: state.slots,
    manage_url: manageUrl
  });
};
