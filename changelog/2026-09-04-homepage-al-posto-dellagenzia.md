# La homepage dice cosa sostituisce: l'agenzia di marketing

La homepage vendeva ancora «i nostri cinque agenti ti fanno i social». Quel prodotto non
esiste più: la chat viene smontata, la squadra di agenti pure.

Il primo tentativo di rifarla diceva *«La tua AI lo scrive. Anomalia lo pubblica.»* — vera,
precisa, e inutile: descrive **il meccanismo**. Nessuno si sveglia la mattina volendo che
qualcosa venga pubblicato. Vuole smettere di pagare un'agenzia.

## Cosa dice adesso

> **La tua agenzia di marketing ora è Claude, ChatGPT o Cursor.**

I tre client si nominano, non si alludono: è quello che rende la promessa credibile invece
che generica. Poi, in ordine: **cosa sostituisce** (i tre lavori di un'agenzia), **il prima
e il dopo**, e solo alla fine **come è possibile**. Il meccanismo è il secondo respiro, non
il primo — nel sottotitolo non c'è più.

## I tre domini, e quanto si può promettere di ciascuno

Prima di scrivere una riga ho fatto verificare cosa il prodotto fa davvero. Il risultato ha
cambiato il testo in tre punti:

- **Social organico** — nove canali, `PLATFORM_KEYS` → Zernio. Solido.
- **Crescita del sito** — il blog è la rivendicazione più forte che abbiamo (articoli scritti
  dalle pagine vere del sito, pubblicati sul dominio del cliente). **Fuori il rank tracking**:
  `brand_rank_snapshots` non ha mai scritto una riga, il codice c'è ma non ha mai prodotto
  niente. E su GEO si dice «i motori AI ti citano», non «tracciamo le citazioni in ChatGPT»:
  `geo.ts` interroga API di LLM, non il prodotto ChatGPT.
- **Ads** — qui il fatto che conta: il motore è **vero e completo** (crea e lancia campagne
  Meta e Google via Zernio, fee 12%), ma `ADS_SELF_SERVE = false` è una costante hardcoded in
  `src/lib/ads-fee.ts:9` e `FEATURE_ADS` è spento di default. **Oggi ogni cliente vede un link
  Calendly.** Quindi la pagina dice: la tua AI legge la Ad Library pubblica di Meta e scrive i
  creativi (`ads_remix`, che funziona ed è ungated), e *«le campagne si attivano con il nostro
  team — quella parte non è ancora self-serve»*. Niente TikTok ads: non esistono.

## I limiti detti ad alta voce

«Sostituire un'agenzia» è una promessa grossa, e regge solo se la pagina dice anche cosa non
fa. Due limiti, in due posti dove non si possono saltare — la riga sotto il prima/dopo e la
prima FAQ:

- **non si inventa il posizionamento**: `brand-analysis.ts` estrae il brand dal sito che già
  esiste, non lo conia dal nulla;
- **non pubblica alle tue spalle**: `create_post` deposita una bozza in attesa, `approve_post`
  è l'unica cosa che autorizza la distribuzione.

## Cosa è stato tolto

Oltre a `TeamRoster`, `HomeChatMockup` (+ `HomeAgentPanel` e il suo test) e `ServiceMockup`:

- **Le tre recensioni in `WhyUs`** — «Marco R., Founder, Flash Camp» e le altre due sono
  scritte su *Flash Camp*, lo stesso brand inventato dei mockup, con cinque stelle sopra. La
  storia dei fondatori (Teta, 30M di view) resta: quella è verificabile.
- **Il video YouTube** — il poster dice «Automate your socials»: era l'ultimo pezzo della
  pagina che vendeva il prodotto vecchio, e una sezione che non fa avanzare il racconto non
  serve. Via anche il suo `<link rel=preload>`.

## Stato delle lingue

Inglese e italiano sono scritti. **Spagnolo e francese portano il testo inglese**: il test di
parità confronta gli insiemi di chiavi fra i quattro cataloghi e una lingua a metà stamperebbe
le chiavi puntate in pagina. Si traducono quando la riga è ferma — se cambia ancora due volte,
averle aggiornate ogni giro è lavoro buttato.
