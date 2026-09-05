# Un guasto nostro non si chiama `media_not_found`

`create_post` aveva un solo modo di dire «il media non c'è», e lo usava per tre situazioni
diverse: l'id è di un altro brand, l'id non esiste, oppure il media **è di questo brand** e siamo
noi a non essere riusciti a firmarlo, scaricarlo e ricaricarlo.

Le prime due sono deliberatamente indistinguibili e restano tali: dire quale delle due è
sarebbe un modo per sondare gli id altrui, e `findBrandMediaByIds` lo dichiara. La terza no: è un
guasto nostro travestito da errore del chiamante.

## Cosa ha mostrato la sessione vera

Con lo Storage locale rotto, un modello esterno ha chiesto un post con un media suo e si è preso
`400 media_not_found`. Un 400 dice «quello che mi hai dato è sbagliato», quindi il modello ha
fatto l'unica cosa sensata data quella risposta: ha corretto. Ha provato altri id della libreria,
poi un prefisso più corto, poi un'altra piattaforma — sei tentativi, nessuno dei quali poteva
funzionare, perché lo Storage non avrebbe servito nessun byte a nessuna richiesta.

Per un agente la confusione fra le due classi non è un fastidio estetico, è un moltiplicatore di
costo. Un umano davanti a un 400 opaco si ferma e apre un ticket; un agente **riprova**, e ogni
riprova è un turno pagato. Uno status dice quanto vale insistere: 4xx significa cambia qualcosa,
5xx significa non sei tu, torna dopo.

## La distinzione, in un posto solo

`resolveMediaUrls` tornava già un risultato taggato. Il tag adesso porta due esiti invece di uno:

- `media_not_found` (400) — l'id non è di questo brand. Percorso di upload fuori dalla cartella
  di chi chiama, id di un altro brand, id inesistente: tutti indistinguibili fra loro, per
  costruzione.
- `media_unavailable` (502) — il media è di questo brand e `publishLibraryMediaAsPostMedia` non
  ce l'ha fatta. La pipeline media è una dipendenza a valle: 502 è la classe onesta.

Niente condizione nuova alla chiamata né nella route. La tabella che decide gli status è sempre
`CREATE_POST.failures`, e la route continua a passare da `statusForFailure`: aggiungere l'esito è
stata una riga in quella tabella. Le due costanti `NOT_THIS_CALLERS_MEDIA` e
`MEDIA_PIPELINE_BROKEN` esistono perché il nome dica di chi è la colpa nel punto in cui si
decide, senza un commento che lo spieghi.

La descrizione del tool dice adesso cosa significano i due esiti, perché è l'unica cosa che il
modello dall'altra parte legge davvero.

## L'asimmetria dei prefissi, dichiarata invece che risolta

Un id di post si può passare come prefisso non ambiguo (`resolvePostId`); un id media no. Il
modello della sessione vera ha provato anche quello, e si è preso lo stesso rifiuto opaco.

Aggiungere la risoluzione per prefisso ai media sarebbe una feature, con una sua superficie
(collisioni, quale errore quando il prefisso è ambiguo) e merita di essere letta da sola. Qui la
scelta è stata rendere onesto il contratto: `media_ids` dichiara che vuole id interi da
`list_media`, e i docs lo ripetono. Costa una frase invece di una feature, e toglie al modello
esattamente il tentativo che ha sprecato.

## Correzione a `2026-09-03-external-agent-media.md`

Quella entry dice che il tetto di 8 media «resta un taglio silenzioso». Vale solo per il manual
posting dalla UI, dove `resolveMediaUrls` tronca a 8. Sul contratto esterno il nono id fa fallire
tutta la richiesta con `invalid_input`, perché `media_ids` porta `.max(8)` in zod e la route
valida prima di chiamare il servizio. Un percorso tronca, l'altro rifiuta; la nota è stata
aggiunta in fondo a quella entry invece di riscrivere la storia.

## Cosa non è stato provato

Il guasto vero — Storage giù, byte non scaricabili, upload rifiutato — non è riproducibile su
questa macchina: lo Storage locale di Supabase è rotto di suo (xattr non supportato sul bind
mount). I test forzano il fallimento dal seam già mockato (`publishLibraryMediaAsPostMedia`), che
è il confine dove la distinzione viene decisa. Non è una riproduzione end-to-end e non viene
spacciata per tale.
