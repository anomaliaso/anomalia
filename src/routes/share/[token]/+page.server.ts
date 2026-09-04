import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';
import { readSharedView, shareFailure } from '$lib/server/shared-views';

// Rotta pubblica, senza sessione: il token È l'autorizzazione, come /approve/[token] e
// /blog/[site]. Legge con la chiave di servizio perché la sola riga raggiungibile è quella la cui
// impronta corrisponde — ad `anon` la tabella resta revocata, così nemmeno una policy sbagliata
// può aprirla. Un link che non vale è un 404 identico per revoca, scadenza e inesistenza; una
// tabella mancante è un 500, perché è un guasto nostro e non una risposta sul link.
export const load: PageServerLoad = async ({ params }) => {
  const shared = await readSharedView(createAdminClient(), params.token).catch((e) => {
    const failure = shareFailure(e);
    if (!failure) throw e;
    console.error('[share]', failure.details);
    throw error(500, 'This link cannot be opened right now.');
  });

  if (!shared) throw error(404, 'Not found');

  return shared;
};
