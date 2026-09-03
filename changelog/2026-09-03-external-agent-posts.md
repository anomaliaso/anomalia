# Un agente esterno può scrivere un post

Primo tracciante del piano [external agent](../docs/external-agent-plan.md): Claude, Cursor o un
altro client MCP scrivono la copy col modello dell'utente, e Anomalia la conserva, la valida, la
manda in revisione e la pubblica. Il modello sta fuori; lo stato resta qui.

## Cosa mancava

La UI di manual posting sapeva già creare un post senza generare niente. L'MCP no:
`GET` e `DELETE /api/v1/brands/:slug/posts` esistevano, `POST` no. Ogni altra strada che crea un
post — `plan_week`, `produce_week`, `chat` — passa dai crediti Anomalia. Un agente che aveva già
scritto la copy non aveva dove metterla.

## Il quarto modo

`createManualPost` aveva i pezzi ma non la combinazione: `draft` dà `pending_user` senza
pubblicare ma butta via la data, `schedule` la data ce l'ha ma poi chiama `publishApprovedPost`.
Mancava la bozza **datata**.

Le due decisioni — se il post ha una data, e se poi pubblica — stavano sparse in due condizioni
diverse. Aggiungere un quarto caso allargandole entrambe è come una regola scritta in due posti
inizia a divergere, quindi prima è stato fatto un commit solo strutturale: `MODE_BEHAVIOUR` dice
per ogni modo da dove prende la data e come finisce. `propose` è una riga di quella tabella.

La data proposta viene conservata **esatta**, non ricostruita passando da un orologio a muro:
un offset esplicito sopravvive, e senza offset si legge sul fuso del brand — la stessa regola che
`reschedule` seguiva già.

## Il calendario mentiva

`getCalendar` escludeva i `pending_user` dalle query sul mese e poi li ripescava tutti insieme
senza filtro di data. Finché un pending non aveva mai una data era innocuo. Con la data proposta,
un post di ottobre compariva anche a gennaio, e in ogni altro mese. Ora una data proposta è già
una posizione nel calendario: il post entra nel suo mese e in nessun altro, e resta bozza solo
chi una data non ce l'ha.

## Il registry dei contratti

Un endpoint era scritto tre volte: la route leggeva il body senza schema, `cli/lib/api.ts`
ricopiava un tipo a mano, il tool MCP riscriveva la stessa forma in zod. Niente li legava, e
infatti erano già divergenti — `PostPatch` della CLI non ha `youtube_thumbnail_url`, che il
server invece accetta, e nessun compilatore se n'era accorto.

`@anomalia/api-contracts` tiene la dichiarazione: metodo, path sotto il brand, schema di request,
schema di response e i fallimenti possibili con lo status HTTP di ciascuno. La route valida e
sceglie lo status da lì, il client ci costruisce la chiamata, l'MCP ci registra il tool.

Descrive il **wire**, non il dominio: `platforms` è un array di stringhe e non una copia
dell'elenco delle piattaforme, perché a decidere quali esistono resta il servizio — altrimenti la
regola torna a vivere in due posti ed è di nuovo deriva.

**Perché una copia e non un import.** La CLI non importa niente fuori da sé: si spedisce come
binario standalone e la sua build Vercel ha per radice `cli/mcp`, che non vede il workspace.
`cli/scripts/sync-contracts.sh` scrive il mirror in `cli/lib/contracts/` e
`cli/lib/contracts.test.ts` fallisce appena i due alberi divergono — la stessa forma già usata
per l'albero delle skill. Scartate: mettere i contratti dentro `cli/` (l'app importerebbe una
directory che l'export OSS esclude) e aggiungere `cli` al workspace npm (ha bun.lock e script di
build suoi).

Versione uno: solo `/api/v1/brands/:slug/<path>`. Un endpoint con `:id` ha bisogno anche della
risoluzione del prefisso, e finché il registry non la sa fare quegli endpoint restano scritti a
mano invece di entrare qui a metà. Un test tiene il limite.

Tre membri, due verbi: `create_post` nuovo, `list_posts` e `get_calendar` migrati coi loro
blocchi scritti a mano cancellati. Meno codice di prima, e l'astrazione non ha una sola
implementazione.

## eval:ux non c'è più

Costruiva uno stack compose intero e guidava un browser vero dentro la chat in-app, su modelli
veri, a soldi veri a ogni giro. Un gate che nessuno può permettersi di lanciare non è un gate: è
una riga in un documento che i report possono citare senza che nessuno l'abbia eseguita. Se n'è
andato anche `scripts/task85-browser.ts`, unico altro consumatore, avanzo di una task chiusa da
un pezzo.

`eval:durability` resta e non è stato toccato — ma il suo fixture stava dentro `scripts/eval/ux/`:
prima un commit di solo rename l'ha portato fuori, poi la cancellazione.

## Fuori da questo giro

Media (upload, libreria, import da URL), generazione di immagini o video, copy generata da
Anomalia, `get_creation_kit` e `check_content`. L'approvazione non cambia semantica: continua a
autorizzare e tentare subito la programmazione.
