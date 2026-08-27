import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// /custom è diventata /agents (la stessa pagina, che ora mostra anche i lavori inclusi nel
// prodotto). Questo redirect NON è cortesia verso i link interni — quelli sono già aggiornati:
// è per i link già SCRITTI NEL DATABASE. Le card di `propose_custom_agent` vivono dentro i thread
// di chat con l'URL vecchio dentro, e quei thread si riaprono. Senza questo file, ogni proposta
// di agente mai fatta porta a un 404.
// 308 e non 302: il percorso è cambiato per sempre, e la query string (?install=, ?agent=) deve
// arrivare dall'altra parte intatta.
export const GET: RequestHandler = ({ params, url }) => {
  redirect(308, `/app/${params.brand}/agents${url.search}`);
};
