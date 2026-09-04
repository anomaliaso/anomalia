# Il piano editoriale nel frontend sottile — `/v2/:brand/strategy`

La quarta superficie del frontend sottile, dopo calendario (#229), post (#235) e materiali
(#247). È "Strategia" nel mockup: il piano editoriale attivo — la scommessa, la voce, dove esce,
le quattro settimane del ciclo — più le poche cose dello studio su cui il piano è costruito.

Sola lettura.

## Perché esiste

Il calendario dice *quando*, i post dicono *cosa*. Nessuna superficie dice *perché quello*. Il
piano editoriale è la risposta che l'agente si è dato e a cui obbedisce ogni settimana: se la
settimana 3 produce carousel invece di reel è perché `content_mix` lo dice, e senza una pagina
che lo mostri quel comportamento sembra un capriccio del modello.

C'è anche una cosa che solo qui si vede: il campo `brief` di una settimana. È il testo che
l'utente ha scritto per sovrascrivere il tema ("settimana del lancio"), e il pianificatore lo
passa verbatim al batch. Se non compare da nessuna parte, nessuno sa che è stato registrato.

## Come è costruita

**Due letture, non tre.** `GET /api/v1/brands/:slug/editorial-plan` (`GET_PLAN`) e
`GET /api/v1/brands/:slug/studio` (`GET_STUDIO`), in parallelo con la lettura del brand.

`GET_WEEKLY_PLAN` è stato letto e scartato: `getWeeklyPlan` interroga la stessa riga
`editorial_plans` di `getEditorialPlan` e ne restituisce un sottoinsieme — `weeks` ridotte a
`{index, theme, status}` invece delle otto chiavi complete, e la stessa `cadence`, `strategy`,
`platform_mix`. Le sue due aggiunte non servono qui: `posts` non è filtrato per settimana (sono
gli ultimi 50 post del brand, cioè esattamente ciò che mostra `/v2/:brand/posts`), e `seeds` è
l'output grezzo del pianificatore. La quota c'è già in `editorial-plan` come `{used, remaining}`.
Una terza richiesta per dati che si hanno già è latenza pagata per niente.

**Il `jsonb` non è un tipo.** `GET_PLAN` dichiara `plan` e `proposed` come oggetti opachi, e a
ragione: la riga la scrive un modello contro uno schema, non un `CHECK` del database. Quindi
`plan-shape.ts` non si fida di niente — `weeks` che non è un array non viene iterato, un tema che
manca ripiega su `title` e poi su "Week 2", una `cadence` numerica non finisce in pagina, una
voce di `content_mix` senza `type` viene saltata invece di stampare `undefined 3`. Sono i modi in
cui una pagina che legge jsonb muore, e sono in un test.

**Le condizioni stanno in una tabella sola.** `WEEK_STATES` dice per ogni stato l'etichetta e il
tono del badge; uno stato che il modello si è inventato passa attraverso col suo nome e tono
neutro invece di rompere il badge.

**`share` è testo, non un numero.** Lo schema di `platform_mix` lo descrive come
«`'40%'` o `'2/week'`»: è prosa del modello. Non c'è nessuna percentuale da calcolare e nessuna
barra da disegnare — si mostra com'è.

**Nessuno stato client.** Niente pannello, niente filtri, niente `replaceState`: la pagina è una
lettura sola e non ha nulla da ricordare.

## Cosa non si può mostrare, e perché non è stato inventato

**Quanto del piano è stato eseguito.** La pagina mostra le quattro settimane e quale è quella
corrente, ma non quanti post ciascuna settimana ha davvero prodotto. `getWeeklyPlan` restituisce
`posts` senza legarli alla settimana (nessun filtro su `editorial_week`, nessun raggruppamento),
e i post hanno `pillar` e `format` ma non l'indice di settimana. Legarli vorrebbe dire scrivere
in questa pagina una regola che decide quale post appartiene a quale settimana — cioè logica di
dominio nel frontend, che è esattamente la cosa da non fare. Serve un endpoint che lo dica.

**Il piano GTM.** `plan.gtm` esiste con `stage`, `summary`, `platform_recs[]` e `plays[]`, ed è
la parte più interessante per un brand a zero. Non è mostrato: è una superficie sua, e mostrarne
un riassunto senza le raccomandazioni per piattaforma direbbe meno di quanto confonde.

**Accettare o rifiutare la proposta.** `SAVE_PLAN` esiste. Se c'è un piano proposto la pagina lo
mostra con il riepilogo delle modifiche e lo dice — ma decidere è un'azione con conseguenze
(sostituisce il piano attivo, e da lì scende tutta la produzione), e questa PR è una lettura.

## Cosa è stato scartato

**Nessuna primitiva nuova.** Solo `badge`, già presente. Nessun `card`, nessun `tabs`: sono
sezioni con un titolo, e `shadcn-svelte add` ha già riscritto `button.svelte` due volte in questo
repository.

**Nessuna utility `grid`.** `app.css` ha un `.grid` globale (`grid-template-columns: 1.7fr 1fr`).
Tutto è flex.

**Nessun import dinamico.** Non c'è niente da rimandare: la pagina non ha pannelli e il suo
JavaScript è quello di SvelteKit più un badge.

**Nessuna chat, nessun link alla chat.**

**Nessuna barra laterale.** Le cinque voci del mockup sono un layout condiviso e non tutte le
superfici esistono. Un link che darebbe 404 non si mette.
