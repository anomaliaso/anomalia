# Le due cose che `/v2` aveva e `/app` no

`/v2` si cancella: il calendario a doppia vista, i materiali, la strategia e i risultati
esistono già in `/app`, e tenerne due copie era il costo senza il beneficio. Tre cose però
non c'erano, e prima di cancellare vanno recuperate. Qui ce ne sono due (il link pubblico
condivisibile lo sta estendendo un altro agente, partendo da #221).

## La guida MCP, in cima alla home

Collegare il proprio agente è la prima cosa che il prodotto chiede di fare, e una guida che
vive dietro un link non la apre nessuno. Sta **sopra** il blocco `{#await}` della panoramica,
non dentro: aspettare le ~30 query di `loadHomeOverview` vorrebbe dire mostrarla al secondo
giro d'occhio, quando la pagina si è già riempita d'altro.

È un `<details>` nativo, aperto, che si chiude e resta chiuso finché la pagina vive. **Non**
prova a indovinare se un agente è già collegato, e il motivo è scritto nel componente: oggi
non esiste nessun segnale per saperlo — l'MCP remoto autentica con un JWT Supabase
indistinguibile da un login del browser, l'OAuth non tiene una tabella di client (il
`client_id` *è* la registrazione, firmata), e `api_keys.last_used_at` è per utente e non
viene mai toccato dal percorso MCP. Fingere «collegato» sarebbe peggio che chiedere un click.

Rispetto alla versione di `/v2` cambiano due cose: le classi Tailwind coi token di `/v2`
diventano la palette del guscio (`--paper`, `--ink`, `--line`) — due palette nella stessa
pagina si vedono — e il testo passa da `svelte-i18n`, con le chiavi `app.mcpGuide.*` nei
quattro cataloghi. `/v2` era in inglese perché era un'anteprima; `/app` no.

## Il pannello del post, dentro il calendario

`?post=<id>` apre uno `Sheet` a destra: anteprima (video, carosello, immagine), la copia
comune e le riscritture per piattaforma, e l'approvazione con la sua conferma.

Prima quel parametro **rimandava** a `/app/<slug>/posts/<id>/preview` — un deep link legacy
delle anteprime in chat. Adesso apre il pannello. La scheda completa non sparisce: il pannello
ha un link verso di lei, o quelle cinque rotte (`preview`, `details`, `edit`, `analytics`,
`boost`) resterebbero senza nessuno che ci porta.

Le due azioni (`editPost`, `approvePost`) passano dagli endpoint invece che da Supabase, come
faceva `/v2`. Non è una preferenza di stile: dietro `approve` c'è la coda di distribuzione, e
riscriverla nel `+page.server.ts` vorrebbe dire tenerne due versioni. Anche il dettaglio arriva
da `/posts/:id/media`, dove le URL dei media sono già firmate.

`captionPatch` è uscito dal `+page.server.ts` e vive in `$lib/post-caption.ts` con sette test.
Non per simmetria: SvelteKit non lascia esportare altro che `load`/`actions` da un
`+page.server.ts`, quindi lì dentro sarebbe stato codice non testabile — e ha due casi che si
sbagliano in silenzio. Il primo: se il form non manda nessun campo `caption_<platform>`,
`platform_captions` non deve comparire nel patch, o cancellerebbe riscritture salvate da
qualcun altro. Il secondo: una riscrittura svuotata a mano non è una riscrittura vuota — è la
richiesta di tornare alla copia comune, e salvata come stringa vuota farebbe uscire un post
senza testo su quella piattaforma.

## La vista del calendario sta nell'URL

`let view = $state<'month' | 'list'>('month')` diventa `?view=list`, letto dal server con
`viewFor` (lo stesso di `/v2`, già sotto test). Un calendario in lista adesso si manda a un
collega, e il tasto indietro torna a com'era. Il toggle passa da due `<button>` a due `<a>`:
funziona anche prima dell'idratazione.

`view` è entrato anche nella `variant` della cache di pagina, insieme a `post`: due viste
diverse non devono condividere una entry.

## Cosa NON è localizzato, e perché

`PostPanel` resta in inglese. Le sue etichette non stanno tutte nel componente: `stateOf`,
`captionFields`, `whenLabel` e `distributionNote` vivono in `$lib/post-state.ts` e le
restituiscono già formate, con 27 test inchiodati a quelle stringhe. Tradurre il pannello
significa cambiare la forma di quel modulo, e non è una cosa da fare di striscio in una PR
che ne sposta un'altra. La guida MCP invece è stata tradotta: dodici stringhe e nessun modulo
sotto.
