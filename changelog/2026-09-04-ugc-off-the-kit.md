# I due UGC escono dal framework, e restano

Ottavo e nono dei dodici, e i due che **non si cancellano**: la produzione UGC è il
prodotto. Il pianificatore (`ugc-plan-agent.ts`, scrive gli script PAS) e il produttore
(`ugc-agent.ts`, li gira) escono dal framework con la stessa ricetta degli altri sette.

## La cosa che stava per sparire con il framework

Due file dentro `src/lib/agent/tools/` non sono mai stati del framework:
`brand-context-tools.ts` (184 righe) e `media-library-tools.ts` (79). Importano `ai`, `zod`,
un tipo di Supabase e — il secondo — `brand-media`. Nient'altro. Ma abitavano dentro
`src/lib/agent`, che è sulla lista da cancellare, e da loro dipendono **quattro cose che
devono sopravvivere**: Motion Video, il Media Generator, il pianificatore UGC e il
produttore UGC.

Il primo è come un generatore sa cos'è il brand — `read_brand_studio`, `read_knowledge`,
`read_market_references`, `search_web`. Il secondo è come guarda e usa la libreria media.
Cancellare `src/lib/agent` con dentro quei due voleva dire togliere ai generatori il
contesto e la libreria: cioè tenere le capacità generative sulla carta e romperle nei
fatti.

Sono stati spostati in `src/lib/server/`, spostamenti puri, ognuno nel suo commit, con gli
import che li seguono e il test che si porta dietro i suoi percorsi relativi.

Dopo questi due, **nessun file di `src/lib/server` importa più `$lib/agent/`.**

## Il test che agganciava la cosa sbagliata

`ugc-orchestrator.test.ts` prendeva il modello finto su `$lib/server/harness`, cioè
sull'involucro. Tolto l'involucro, il finto non veniva più chiamato e il test passava a
vuoto — anzi, falliva. Adesso aggancia `generateText` dell'SDK, che è il confine che
sopravvive: lo stesso test vale su entrambe le implementazioni, che è il punto della
ricetta.

## L'arco che spariva

Prima entrambi arrivavano a `chat/model` e `chat/controller` per `harness/index`, e a
`$lib/agent` per `brand-context-tools`. Adesso nessuno dei due, per nessuna delle due
strade.

## Cosa non cambia

Il cliente non osserva niente: stessi script, stesse clip, stesse righe. Nessun changelog
pubblico.
