# 96 export che nessuno importa, dentro file vivi

1.400 righe in 70 file. I file restano — sono raggiungibili e servono. Sparisce quello
che dentro non serve piu' a nessuno.

## Due categorie, una sola cancellata

Un `export` mai importato altrove puo' voler dire due cose molto diverse:

1. **il simbolo e' usato dentro il proprio file** — allora e' vivo, e solo la parola
   `export` e' di troppo. **Non l'ho toccato**: togliere `export` non cancella codice,
   cambia una visibilita', ed e' un refactor. Sono 960 simboli in 342 file: un elenco,
   non una PR.
2. **il simbolo non compare nemmeno una seconda volta nel proprio file** — la
   dichiarazione e' l'unica occorrenza in tutto il repository. Quello e' codice morto,
   e sono questi 96.

## Come ho provato che erano morti

Per ogni `export ... NOME` ho cercato `NOME` come parola intera in **ogni** file di
testo tracciato (`.ts`, `.svelte`, `.json`, `.md`, `.sql`, `.yml`, `.sh`, `.py`, …),
escluso il file che lo dichiara. Zero occorrenze fuori, e **una sola dentro** — la riga
della dichiarazione.

Il grep e' volutamente largo: prende anche le stringhe e i commenti, quindi un simbolo
raggiunto per nome da una tabella, da una configurazione o da un `import()` costruito
sarebbe risultato vivo e sarebbe rimasto in piedi.

Poi il taglio a cascata: tolta la funzione, i suoi import e i suoi helper privati
restano orfani. Ho ripetuto il conteggio **dentro** ogni file toccato finche' non si e'
stabilizzato (tre giri), rimuovendo import inutilizzati e dichiarazioni top-level senza
piu' riferimenti.

## Un errore preso in mezzo, e la regola che ne esce

Il primo passaggio ha cancellato `PIN_GEMINI` da `gtm.ts` — dove e' usato **otto volte**,
sempre come `{ ...PIN_GEMINI }`. Il conteggio escludeva le occorrenze precedute da un
punto per non contare gli accessi a proprieta' (`obj.nome`), e lo spread `...NOME` gli
somigliava. `svelte-check` l'ha preso: `Cannot find name 'PIN_GEMINI'`, tre volte.

La regola che ne resta: **in un censimento di codice morto si conta per eccesso.**
Contare una occorrenza in piu' lascia in piedi qualcosa di morto e costa una riga;
contarne una in meno cancella codice vivo e costa un incidente. Il punto iniziale ora e'
ammesso, e la lista e' piu' corta di conseguenza.

## Le due decisioni prese contro un commento esplicito

- `distillWallDigests` (`wall-digest.ts`, 87 righe) diceva di se': «Senza chiamante da
  quando il muro pubblico e' stato spento … Resta esportata perche' la si possa lanciare
  a mano». Non esiste nessuno script, nessun endpoint e nessun comando che possa
  lanciarla a mano: e' la conservazione difensiva che CLAUDE.md rifiuta — complessita'
  pagata oggi per un'eventualita' che non arriva.
- `createBacklinkOrder` (`backlink-external.ts`) e' `@deprecated`, «Kept for callers that
  still pass provider». Quei chiamanti non ci sono.

Se una delle due deve restare, si ripristina da qui; ma allora le serve un chiamante,
non un commento.

## Cosa ho lasciato fuori di proposito

- `src/lib/chat-reasoning.ts`, `src/lib/stores/chat.ts`, `src/lib/shell-prefs.ts` —
  hanno export morti, ma la chat la sta smontando un'altra PR e due tagli sullo stesso
  file diventano un conflitto invece che una cancellazione.
- Tutto `src/lib/server/chat/`, `src/lib/agent/`, `media-generator/`, `motion-video/`,
  `packages/agent-*`, `src/routes/v2/` e i contratti generati.
- I file `.svelte`: li' un export e' una prop, e una prop si usa per nome
  nell'attributo del genitore. Il censimento non e' affidabile e non ho tagliato.
