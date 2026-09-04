# Una pagina sola per i post: calendario e lista, col dettaglio in un pannello

Il nuovo frontend aveva due superfici per la stessa cosa. `/v2/[brand]/calendar`
mostrava il mese, `/v2/[brand]/posts` mostrava la lista filtrabile, e ognuna si
era portata dietro la propria copia di `PostPanel.svelte` — scritte in parallelo
da due PR, divergenti già alla nascita (una confermava l'approvazione con un
alert dialog, l'altra in linea). La tabella degli stati esisteva due volte:
dentro `post-state.ts` e di nuovo dentro `calendar-month.ts`.

Adesso la superficie è una: `/v2/[brand]/calendar`, con la vista nell'URL.
`?view=calendar` (default) disegna la griglia mensile, `?view=list` la lista coi
filtri di stato. Nessuno store, nessun `$state` per la vista o per il post
aperto: l'interruttore è un link, aprire un post è un link (`?post=<id>`), e il
`load` decide cosa leggere. La conseguenza voluta è che indietro chiude il
pannello e che un link a un post arriva già aperto.

`/v2/[brand]/posts` non è stata cancellata: è un `+server.ts` che risponde 302
verso `?view=list` tenendo `status` e `post`. Non è cortesia — la dashboard
(PR #244, che non si tocca) linka ancora quella rotta in tre punti, e senza il
redirect quei tre link diventerebbero 404 alla prima merge.

## Cosa è rimasto nel dettaglio, e cosa no

Il pannello fa tre cose: mostra l'anteprima, lascia modificare le caption a
mano, approva. Sono sparite le altre: il link "See it live" al post pubblicato,
l'alert dialog di conferma (resta la conferma in linea, che è la stessa cosa con
meno componenti), e il paragrafo che spiegava cos'è l'approvazione — resta la
riga che dice *quando* esce, che è l'unica informazione che cambia da post a
post.

L'anteprima è la parte che mancava del tutto. Il pannello legge il post da
`GET /posts/:id/media`, l'unica lettura per singolo post che esiste: è lei a
sapere se il post è un video, se è un carosello e quali sono le slide
renderizzate. Metterlo a decidere al frontend da `content_type`/`format`
avrebbe voluto dire riscrivere `isVideoPostRow` una seconda volta, in un posto
dove nessuno l'avrebbe più tenuta allineata.

Quella lettura non esponeva tre colonne che il pannello usa davvero
(`platform_captions`, `scheduled_for`, `slot`): sono state aggiunte alla select
e al ritorno di `readPostState`. Additivo, e utile anche all'agente che da lì
riprogramma.

`previewOf`, `captionFields`, `extrasOf` e `viewFor` stanno in `post-state.ts`
perché sono decisioni con dei casi, e i casi si scrivono in un posto solo:
`previewOf` mette il carosello prima dell'immagine (la `media_url` di un
carosello è la copertina, e mostrarla al posto delle slide sarebbe una bugia
silenziosa), `viewFor` ricade sul calendario per qualsiasi valore inventato.
Sono le uniche cose testabili del pannello, e sono testate.
