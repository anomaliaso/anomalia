# `get_knowledge_status` — caricato non è digerito

## Il problema, in una frase

`search_knowledge` (PR precedente) può tornare vuoto per due motivi opposti:

- il corpus è indicizzato e **il brand non sa quella cosa** → si risolve caricando un documento;
- il documento che la contiene **non è mai stato processato** → si risolve sbloccando la pipeline.

Un agente che non sa distinguerli fa la mossa sbagliata metà delle volte, e con sicurezza.

## La pipeline, e dove si rompe

```
brand_documents ──processDocument──▶ brand_doc_chunks ──writeChunkEmbeddings──▶ .embedding
   status: pending                        chunks.total                        chunks.embedded
        → processing
        → ready | failed
```

Tre stadi, tre modi di fermarsi, e nessuno di essi era visibile da fuori. `get_studio` elencava i
documenti senza dire se erano stati letti.

## Cosa risponde ora `GET /api/v1/brands/:slug/knowledge`

- `documents` — il conteggio stadio per stadio, più `indexed`: **l'unico numero che la ricerca
  vede**. Un documento `ready` con zero chunk (una nota anteriore alla pipeline: `status` nasce
  con default `'ready'` dalla migrazione 0111) esiste nell'elenco e non è cercabile.
- `chunks.total` / `chunks.embedded` — se il secondo è sotto il primo la ricerca gira solo su FTS,
  e una parafrasi manca il bersaglio. Prima non lo sapeva nessuno.
- `failures` — id, titolo, **il motivo** e i tentativi. Venti al massimo: sessanta guasti
  riempiono la finestra di chi ha chiesto lo stato.
- `collections` — quali scaffali hanno qualcosa di indicizzato, così `search_knowledge` sa cosa
  ha senso restringere.
- `sources` — Drive, Notion, GitHub, Gmail: stato, ultimo sync, ultimo errore, documenti portati.

## Le decisioni

**Le fonti le unisce la rotta, non `knowledge.ts`.** `knowledge-sources.ts` importa già
`knowledge.ts` (`countBrandDocuments`, `docLimitForPlan`, `kickKnowledgeWork`): chiamare
`loadKnowledgeSources` da dentro `knowledge.ts` avrebbe chiuso un anello. `knowledgeStatus`
descrive il corpus, la rotta — che è l'adattatore — ci mette accanto le fonti.

**`countEmbeddedChunks` conta con `head: true`.** Contare gli embedding senza tirarsi dietro
768 float per riga: `count: 'exact', head: true` più `.not('embedding','is',null)`.

**Niente `gateAiAction`.** Sono conteggi.

## `get_studio` rinforzato

Il contratto diceva `documents: z.array(JsonObject)`, `kit: JsonObject.nullable()`,
`products`, `history`, `competitors` uguali: cinque array di oggetti generici, in un registry che
esiste apposta per non far indovinare. Ora i campi sono quelli che `getStudio` seleziona davvero,
dichiarati con `looseObject` — così il dump continua a portare quello che la tabella aggiungerà
domani senza rompere chi legge un campo non ancora nominato.

**Cosa cambia davvero, non solo nella dichiarazione:** ogni documento porta `status` e
`chunkCount`. Elencare un documento senza dire se è stato digerito è precisamente ciò che fa
credere a un agente di avere una conoscenza che la ricerca non vede.

**Cosa si rompe, detto invece che forzato:** `output` non viene parsato a runtime da nessuna
parte — `callEndpoint` restituisce il corpo così com'è e `registerTool` riceve solo `inputSchema` —
quindi irrigidire i campi non può rompere un chiamante. La **descrizione** invece sì, è visibile
in `tools/list`, ed è cambiata di proposito: dice che i documenti portano lo stato, e manda a
`search_knowledge` chi ha una domanda invece di far leggere il corpus intero. Il test che fissa le
descrizioni della migrazione (`cli/mcp/read-tools.test.ts`) è diventato rosso ed è stato
aggiornato con il motivo scritto accanto — ha fatto esattamente il suo lavoro.

## L'isolamento fra brand

Come per la ricerca: sul percorso a chiave API il client è quello di servizio, la RLS non filtra
niente. Il finto Supabase del test contiene **due brand** — il vicino ha 40 documenti falliti e 99
chunk — e il test pretende `total: 6`, `failed: 1`, `chunks.total: 15` e che il titolo del vicino
non compaia da nessuna parte nella risposta serializzata.
