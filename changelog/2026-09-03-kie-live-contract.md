# Quattro cose che i docs di kie dicevano sbagliate

## Perché esistono questi test

La suite gira su payload che costruiamo noi e confrontiamo con quello che la documentazione
**dice**. Nessun test poteva vedere quello che il provider **fa**, e i tre tool video erano stati
mergiati senza che una sola chiamata vera fosse mai partita.

Una sessione contro kie con la chiave reale, il 2026-09-03. Quattro difetti, ognuno un fallimento
al 100% in produzione:

## 1. `kling-3.0/video` pretende due campi documentati opzionali

Senza `multi_shots`: `422 multi_shots cannot be empty`. Aggiunto quello: `422 sound cannot be
empty`. Con entrambi il task passa e il video esce — misurato, 42 crediti, 1.36 MB di mp4.

Sono esattamente i due campi che una lettura onesta dei docs lascia fuori. Ogni clip Kling
sarebbe fallita, e il messaggio non dice che mancavano *dalla nostra richiesta*.

## 2. `kling-3.0/motion-control` rifiuta `mode` con qualunque valore

`std`, `pro`, `standard`, `professional`: tutti `500 mode is not within the range of allowed
options`. Senza il campo, accettato. La pagina docs del modello documenta `std|pro`.

Il nostro `buildTransformInput` mandava `mode: args.mode ?? 'std'` **sempre**. Ogni motion control
falliva dopo un giro di rete intero.

## 3. Un task Aleph si interroga su `jobs/recordInfo`, non su `runway/record-detail`

Questo è il peggiore, perché non è un errore: `runway/record-detail` risponde **200 con `data:
null`**. Un vuoto. Il nostro poll avrebbe aspettato fino al timeout di dieci minuti e poi dichiarato
"non ha restituito niente" un render **eseguito e fatturato** — la definizione esatta di clip
pagata e raggiungibile da nulla che questo codice ha già un commento per evitare.

Sullo stesso task `jobs/recordInfo` torna tutto, sotto il nome `runway/gen4-aleph`.

## 4. Motion control pretende una PERSONA nel video guida

`No valid characters detected in the video`, a job già accettato, su una clip senza esseri umani.
Non è un difetto di codice ma è un requisito che il modello colpirà di continuo, quindi ora sta
nelle descrizioni dei tool invece che in un fallimento a valle.

## Come sono difesi

`src/lib/server/video.kie-live.test.ts`, **skippato senza `KIE_LIVE=1`**, così `npm test` non
spende mai per sbaglio:

```bash
KIE_LIVE=1 node --env-file=.env node_modules/.bin/vitest run src/lib/server/video.kie-live.test.ts
```

Verificano la **submit**, non il render finito: kie rifiuta un payload malformato prima di
generare, e un rifiuto costa zero — misurato, i job falliti hanno `creditsConsumed: 0`. Aspettare
il video misurerebbe la qualità del modello, che non è quello che questi test difendono.

Due asserzioni sono scritte al negativo di proposito — «il rifiuto NON parla di `mode`», «`data`
di `runway/record-detail` è null» — perché è la forma che fallisce se qualcuno rimette la versione
dei docs.

## Cosa resta non verificato

Il percorso completo dentro il prodotto: `renderVideo` → Storage → `brand_media`. Qui è verificato
il confine col provider, che era la metà mai toccata. Il render di prova è partito dal payload del
nostro builder, non da un turno di chat.
