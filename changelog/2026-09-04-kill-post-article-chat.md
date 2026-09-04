# Via le chat per-post e per-articolo

Primo passo dello smantellamento delle chat. Anomalia diventa un'interfaccia
quasi headless per agenti esterni via MCP: il modello esterno ragiona e scrive,
Anomalia conserva, valida, pubblica e misura. Il frontend resta minimale e senza
logica, quindi le conversazioni in-app spariscono — anche quelle attaccate a un
singolo post o a un singolo articolo.

Si comincia da qui perché sono le foglie: nessun altro modulo le importa, e la
loro rimozione non tocca la shell dell'app (sidebar, command palette, top bar),
che dipende ancora dallo store delle chat e va smontata nelle PR successive.

## Cosa spariva

- `app/[brand]/posts/[id]/chat/` — la tab "Chat" del post, un wrapper su
  `PostEditor` con `panels="chat"`.
- `app/[brand]/content/[id]/chat/+server.ts` — l'endpoint SSE che serviva quella
  conversazione (carica il transcript, esegue i tool sul post, restituisce lo
  stream).
- `app/[brand]/site/edit/[id]/chat/+server.ts` e
  `components/blog/ArticleChat.svelte` — la chat dell'editor articoli, con undo/redo
  di versione.
- `lib/server/blog-chat.ts` — revisione del corpo articolo, del passaggio
  selezionato, commit e navigazione fra versioni. Restava senza chiamanti una
  volta tolto l'endpoint: `loadChatState` era la sua ultima ancora, dal `load`
  della pagina.

## Cosa resta in piedi, e perché

**Il compositore con le immagini di riferimento resta.** Dentro `PostEditor` la
chat condivideva con la **rigenerazione** lo stesso blocco: `feedback`,
`refImages`, `refPicks`, il brand picker, `onPickRefs`, il contatore revisioni.
La rigenerazione non è una chat — è generazione di contenuti, e va tenuta. È
sparita solo la metà chat: `chatMessages`, `sendChat`, `loadChat`, `flattenChat`,
`applyPostState`, il pannello `<aside class="lb-chat">` e il suo CSS. Il file
passa da 1864 a 1576 righe senza perdere una sola funzione dell'editor.

**`mediaRefs` e `mediaLoading` restano.** Sembravano roba della chat: le usa
anche il picker della thumbnail YouTube (`openYtPicker`), che con la chat non
c'entra niente. Cancellarli avrebbe rotto una feature viva.

**`ChatToolChips` non si cancella qui.** `PostEditor` smette di importarlo, ma il
componente serve ancora a `ChatLiveStatus`, che a sua volta sta dentro il media
generator e il motion video. Muore, se muore, in una PR successiva — e solo dopo
aver scollegato quei due.

**La generazione della copertina articolo resta.** `?/generateCover` è una form
action, non una chat: passa da tutt'altra strada.

## Cosa è stato tolto perché sarebbe rimasto morto

Le affordance "Chiedi alle AI" dell'editor articoli — l'overlay sulla copertina,
il node view TipTap sulle immagini del corpo, la bolla sulla selezione di testo —
avevano un solo trasporto: la chat dell'articolo. Lasciarle avrebbe significato
spedire tre bottoni che non fanno niente, che è peggio che toglierli. Con loro se
ne va `askAiImageExtension`, e le immagini del corpo tornano all'`Image` di
TipTap: `BlogEditor` passa da 503 a 158 righe.

La pagina "Campaign" del post proponeva un brief e poi offriva "Apri chat
editor". Il brief resta — ora si copia e si passa al proprio agente — e il
bottone porta all'editor.

## Tabelle non toccate

`blog_chat_messages` (o come si chiama la tabella dietro `loadChatState`) e le
righe della conversazione per-post restano dove sono. **Nessuna migration**: i
dati si cancellano quando lo decide Andrea, non insieme al codice.
