# La homepage racconta il prodotto nuovo: porti la tua AI, Anomalia pubblica

La homepage vendeva ancora «i nostri cinque agenti ti fanno i social». Quel prodotto
non esiste più: la chat viene smontata, la squadra di agenti pure. Quello che è
rimasto — e che è il fossato vero — è l'altra metà: il cliente collega **il proprio**
Claude o Cursor via MCP, il suo modello pianifica e scrive con il suo abbonamento, e
Anomalia fa tutto quello che un modello di chat non sa fare.

## Cosa dice adesso

Una frase sola, e il resto della pagina la dimostra:

> **La tua AI lo scrive. Anomalia lo pubblica.**

La sezione centrale è due colonne, «La tua AI» e «Anomalia», con dentro solo cose che
il codice fa davvero oggi. Ogni riga della colonna di destra ha una fonte:

- i limiti per piattaforma vengono da `src/lib/platform-limits.ts` (X 280, Bluesky 300,
  Threads 500, IG/TikTok 2200, LinkedIn 3000, YouTube 5000; `need_media`, `need_video`,
  `reddit_title`), controllati in tre punti compreso il backstop prima della chiamata al
  provider in `publish.ts`;
- il render e l'animazione in video sono `render_post` / `make_video` (kie.ai);
- la pubblicazione è Zernio, e le nove piattaforme dello strip vengono lette a runtime
  da `PLATFORM_KEYS`: la lista non può divergere da quello che il publisher supporta;
- le metriche di ritorno sono quelle che `syncZernioAnalytics` scrive e `get_analytics`
  rilegge.

## Cosa è stato tolto, e perché

- **`TeamRoster.svelte`** (215 righe) — la griglia dei cinque agenti. Quel racconto è
  finito, e un elenco di agenti copiato in una pagina è già diventato falso due volte
  in questo repo.
- **`HomeChatMockup.svelte`** (810) e **`HomeAgentPanel.svelte`** — il finto schermo di
  chat, con il suo test. La chat viene rimossa dal prodotto: tenere un mockup che la
  vende è la definizione di promessa falsa.
- **`ServiceMockup.svelte`** (322) — quattro finti screenshot del dashboard che mostrano
  l'app che genera le bozze da sola. Il posto che occupavano lo prende lo strip dei
  canali: nove parole, zero immagini, e generate dalla tabella vera.
- **Le tre recensioni in `WhyUs`** — «Marco R., Founder, Flash Camp» e le altre due sono
  scritte su *Flash Camp*, lo stesso brand inventato dei mockup: sono placeholder con
  cinque stelle sopra. Una di loro («i post sono meglio di quelli che facevo io»)
  contraddiceva pure il racconto nuovo. La storia dei fondatori — Teta, 30M di view —
  resta: quella è verificabile e centrata.

Le chiavi i18n corrispondenti (`landing.team`, `landing.chat`, `landing.services`,
`landing.whyus.reviews`, e le sei FAQ vecchie) sono state cancellate da tutti e quattro
i cataloghi nello stesso commit, altrimenti `locales.test.ts` cade.

## Decisioni prese e scartate

**Scartato: lazy-load di pricing e FAQ.** Sono 163 + 78 righe e stanno nell'HTML SSR
che Google legge. Il guadagno di toglierle dal primo paint non paga la macchinaria, e
la pagina ha già perso 1.350 righe di markup.

**Scartato: le icone dei social nello strip.** `PLATFORM_META` non ha l'icona di
LinkedIn, quindi la fila sarebbe stata mista. Le etichette da `PLATFORM_KEYS` costano
zero byte e restano automaticamente vere.

**Scelto: flex e non grid** per le due colonne. `app.css` ha una `.grid` globale
(`grid-template-columns: 1.7fr 1fr`) che dirotta qualsiasi elemento con quella classe.

**`mcp.anomalia.so` non è servito da questo repo.** L'endpoint risponde (401 senza
token, che è la risposta giusta per un server MCP con OAuth) ma il progetto Vercel che
lo serve è agganciato al repo pre-monorepo. La pagina dice *che* si collega la propria
AI e rimanda al dialog che già esisteva; non abbiamo aggiunto nessuna istruzione nuova.

## Cosa resta aperto

Il video YouTube incorporato ha come poster «Automate your socials»: è l'ultimo pezzo
della pagina che racconta il prodotto vecchio, e non si sistema con una PR di codice.
Anche `/pricing` è ancora su «Your social media, on autopilot» e «Pro — the full
autonomous manager».
