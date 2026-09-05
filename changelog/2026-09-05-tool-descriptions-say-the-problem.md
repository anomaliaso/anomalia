# Le descrizioni dei tool dicono il problema, non il nostro flusso

Tre sessioni vere sono fallite con lo strumento giusto nella lista.

«Puoi generare la img di un gatto?» → «non ho uno strumento di generazione immagini generico in
questa chat». Insistendo, l'agente ha ricontrollato e riconfermato; alla terza domanda ha ammesso
che si poteva, chiamandolo «sprecare una generazione». La descrizione diceva: *«Draw a NEW image
into the brand media library from a prompt, then pass the id it returns as media_ids on
create_post … BILLS A RENDER PER IMAGE (about 8 credits each…)»*. Tre àncore in tre frasi —
libreria di un brand, serve a fare un post, costa — e l'agente ha letto correttamente quello che
avevamo scritto.

Poi: un'immagine in libreria da rendere rossa, e l'agente ne ha disegnata una nuova con
`refine_image` nella stessa lista. E «puoi animarlo con un video di 5s?» → «l'animazione è esposta
solo per la copertina di un post», e ha rinunciato.

**La diagnosi è l'ordine, non il contenuto.** Ogni descrizione apriva sul contesto (dove atterra
l'asset, a cosa serve dopo, quanto costa) e seppelliva il verbo. Un agente cerca il *proprio*
problema nella lista, con le parole di chi gliel'ha chiesto.

## Le regole applicate qui

1. **Prima frase: il problema, con le parole dell'utente.** «To change a photo you already have —
   "make it red"» prima di `refine_image`.
2. **Non ancorare a un flusso che il tool non richiede.** «into the brand media library», «then
   pass to create_post» descrivono *un* uso e lo fanno sembrare *l'unico*. Restano, subordinati.
3. **Via le tariffe scritte a mano.** «about 8 credits each» è la frase che ha prodotto la parola
   *spreco*, ed era pure imprecisa. Si dice **che** costa, non **quanto**: il quanto lo misura la
   risposta (`renders`), non lo stima la descrizione. E si dice cosa **non** costa — un agente
   prudente evita ciò di cui non conosce il prezzo.
4. **Il tool fratello è nominato.** `refine_image` ↔ `generate_image`, `generate_video` ↔
   `make_video`. Due volte su tre l'agente si è arreso avendo la soluzione nella stessa lista.
5. **Cosa il tool NON fa**, quando è ciò che toglie la paura di provare: «creates nothing in the
   calendar», «publishes nothing», «needs NO post».

## `make_video` è descritto per quello che è

Genera *e* attacca: anima la copertina di un post che esiste già. È la ragione per cui l'agente
credeva che animare fosse lavoro da post. Ora lo dice, e manda a `generate_video` tutto il resto.
La sua rimozione resta una decisione separata, da prendere quando ci sarà un percorso senza post e
si vedrà se qualcuno lo chiama ancora.

## Il controllo che rende questo verificabile

`packages/api-contracts/src/findability.test.ts` è una tabella: la richiesta arrivata in chat, il
tool che doveva risponderle, le parole che la descrizione deve contenere. Se non le contiene,
l'agente non lo trova — e il test è rosso. La seconda riga della stessa tabella vieta la tariffa
scritta a mano (`/\d+\s*credits?/`). Rosso osservato prima della riscrittura: `refine_image` senza
«photo» né «red», `make_video` senza «post», e la tariffa di `refine_image`.

Si estende con una riga per ogni tool riscritto — ne restano circa 120.

## Coordinamento

`generate_image` non è qui: la sua descrizione va insieme al lavoro che rende `slug` opzionale
(altrimenti nasce un parametro opzionale che nessun agente sa quando lasciare vuoto), ed è tenuta
da quel branch. Il testo concordato gli è stato passato.
