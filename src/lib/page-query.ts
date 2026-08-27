import { getContext, setContext } from 'svelte';
import { page } from '$app/state';

/**
 * I PARAMETRI DELLA PAGINA — uno solo, uguale dentro e fuori dalla modal.
 *
 * Da quando le pagine del brand si aprono in sovrapposizione (PageModal) l'URL del
 * browser NON cambia mai: `page.url.searchParams` è quello della pagina SOTTO, non
 * dell'href che è stato aperto. Il `load` server i parametri li vede lo stesso
 * (`preloadData` riceve l'href completo, query inclusa), quindi il difetto è muto:
 * la pagina si apre giusta e ignora l'argomento. `/knowledge?doc=X` mostrava
 * Knowledge senza aprire il documento.
 *
 * Stessa forma di PAGE_META_SINK (stores/page-meta.ts): chi ospita mette in contesto
 * la query vera, chi legge chiede a questo helper invece che a `page`. Una pagina non
 * deve sapere se è ospitata.
 */
const PAGE_QUERY = Symbol('page-query');

/** Chiamata da chi ospita una pagina fuori dal suo posto, con la query dell'href aperto. */
export function setHostedQuery(search: () => string): void {
  setContext(PAGE_QUERY, search);
}

/**
 * Il lettore dei parametri della pagina corrente. Va chiamato durante l'init del
 * componente (come ogni `getContext`); il risultato si legge dentro `$derived`/`$effect`
 * e resta reattivo in entrambi i mondi.
 *
 *     const q = pageQuery();
 *     $effect(() => { const doc = q('doc'); … });
 */
export function pageQuery(): (key: string) => string | null {
  const hosted = getContext<(() => string) | undefined>(PAGE_QUERY);
  if (hosted) return (key) => new URLSearchParams(hosted()).get(key);
  return (key) => page.url.searchParams.get(key);
}
