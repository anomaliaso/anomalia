# Il cancello guardava due superfici come se fossero una, e ne bastava la sbagliata

`findability.test.ts` leggeva `SKILL.md` e `references/tools.md` concatenate. Non sono la stessa
cosa: SKILL.md si carica sempre, tools.md sta sotto «References (load on demand)» e un agente può
non aprirla mai. Concatenandole, una parola presente solo nel riferimento faceva passare la riga
mentre **la superficie che si legge davvero taceva** — cioè esattamente il difetto che quella
tabella esiste per prendere.

Preso sul vivo, non in teoria. Spostando `list_products` dentro `query`, la domanda «what does this
brand sell» è finita in `tools.md`; `SKILL.md` è rimasta senza né «sell» né «products», e il test
era **verde**. Un agente che legge solo SKILL.md — il caso normale — passava da avere
`list_products` nella lista dei tool ad avere niente.

Ora la tabella guarda `SKILL.md` e basta. `tools.md` resta coperta da `tools-coverage.test.ts`, che
pretende ogni tool documentato lì: non serviva una seconda guardia più debole sopra.

## E le parole da sole non bastavano

Seconda falla, trovata dalla stessa verifica: `search_knowledge` passava con «question», «answer» e
«documents» — parole che stanno in qualunque pagina di prosa inglese. La riga era verde e SKILL.md
**non nominava il tool nemmeno una volta**. Una corrispondenza di parole senza il nome non porta da
nessuna parte: il nome è ciò che trasforma il riconoscimento in una chiamata.

Quindi la riga adesso pretende anche il nome del tool nella skill. Rosso osservato su quattro:
`search_knowledge`, `render_post`, `regenerate_post_media`, `generate_media` — quattro domande
d'utente che la superficie letta per prima non sapeva instradare.

## La regola che ne esce, e il suo limite

**Una domanda che sta nella tabella dev'essere instradabile da SKILL.md da sola.** Se un tool non
merita una riga nella mappa, allora la sua domanda non merita una riga nella tabella: la mappa non
è un catalogo, ed è la stessa ragione per cui `instructions` non elenca i tool. Le due cose si
tengono, o la mappa diventa la lista che già esiste due volte.

Le quattro aggiunte a SKILL.md sono instradamenti veri, non parole messe lì per far passare il
test: `search_knowledge` non aveva alcun percorso dalla mappa, `render_post` e
`regenerate_post_media` non erano distinguibili l'uno dall'altro né da `refine_image`, e
`generate_media` è la porta vecchia che ora dichiara di esserlo e manda avanti.
