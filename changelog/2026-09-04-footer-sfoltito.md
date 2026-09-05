# Footer: da 50 link a 21

Il footer elencava mezzo sito: 50 link su 5 colonne, con `Insights`, `Blog`, `Compare` e
`Changelog` ripetuti due volte ciascuno. Un footer che elenca tutto non è una mappa, è un
muro: nessuno lo legge, e i link che contano davvero — documentazione, prezzi, legale —
annegano fra le pagine SEO.

Ora sono quattro colonne e 21 voci:

- **Product** — usecases, autoposts, autoblog, ai-seo-agent, leads-finder, news-radar, pricing
- **Developers** (colonna nuova) — docs, docs/mcp, docs/cli, docs/api, agents
- **Company** — faq, changelog, privacy, terms, preferenze cookie
- **Resources** — blog, /tools, llms.txt, status

Le colonne «Problems we solve» (8 pagine dolore) e «Free tools» (9 tool singoli) spariscono
come colonne. Le pagine **non spariscono**: restano raggiungibili per URL e dalla sitemap, e
i tool si raggiungono dall'indice `/tools` che ora è nel footer. Togliere un link dal footer
è reversibile e non produce nessun 404 — è per questo che questa è la prima PR della pulizia
e l'unica che non cancella niente.

La colonna **Developers** è nuova per una ragione precisa: con il prodotto che si sposta
sull'agente esterno del cliente, MCP, CLI e API sono la superficie che conta, e finora non
avevano un posto nel footer. `/docs/mcp` in particolare non era linkato da nessuna parte e
non era nemmeno in sitemap.

Chiave i18n aggiunta: `marketing.footer.developers` in tutti e quattro i cataloghi (en, it,
es, fr) — il test `src/lib/i18n/locales.test.ts` pretende parità e ha ragione.

Le chiavi `pain*` e `freeTools` restano nei cataloghi: le pagine dolore esistono ancora e
`freeTools` ora è il titolo del link all'indice. Nessuna chiave orfana introdotta.

## Cosa NON è stato toccato

`marketing.footer.tagline` e `marketing.footer.ctaHeading` vendono ancora il prodotto
vecchio («An AI that runs your social media», «Anomalia plans, creates and publishes your
content»). Riscrivere la copy è un lavoro diverso da sfoltire i link, e va fatto insieme
alle pagine che raccontano la stessa storia — non di straforo dentro una PR di manutenzione.

---

# E la navbar: via tema, lingua e «Sign in» dal desktop

Stessa famiglia, stesso file adiacente: il cromo del sito pubblico. La barra desktop a destra
aveva cinque cose — interruttore tema, selettore lingua, GitHub, «Sign in», CTA — più il
burger. Ora ne ha tre: **GitHub, la CTA, il burger**.

**Non spariscono: cambiano posto.** Il drawer mobile (≤640px) le aveva già tutte e tre e le
tiene. `LangToggle.svelte` non si tocca, e nemmeno la logica del tema.

Il `MutationObserver` su `data-theme` **resta, e non è codice che gira per niente**: il layout
di root possiede il tema, questo componente lo rispecchia soltanto, e il pulsante del drawer
ha ancora bisogno che l'icona sole/luna sia allineata quando un'altra scheda cambia il tema.
Tolto il pulsante desktop, l'osservatore ha ancora un consumatore.

CSS diventato morto e rimosso: le due regole `@media (max-width: 640px)` che nascondevano
`.nav-right .theme-toggle` e `.nav-right .lang` (non c'è più niente da nascondere) e le due
regole `.nav-login`, che il drawer non ha mai usato — usa `.nav-dialog-link`.

## «Sign in»: resta una porta?

Sì, e va detto quale. La CTA principale punta a `/app`, e `/app` da sloggato risponde
**303 → `/login`**: verificato. Quindi un cliente esistente che clicca il bottone principale
arriva comunque alla pagina di accesso.

Il costo, che non nascondo: quel bottone si chiama «Get started», non «Accedi». Chi torna
deve intuire che il pulsante da nuovo cliente è anche la sua porta. Su mobile no — lì il
drawer ha ancora «Sign in» esplicito.

## Tema e lingua su desktop: non è un vicolo cieco

Erano l'unico punto sul sito pubblico desktop, ma **non l'unico punto del prodotto**:

- tema → `/app/[brand]/settings/appearance`
- lingua → `/app/[brand]/settings/language`
- e la documentazione ha un `LangToggle` tutto suo in `docs/+layout.svelte`

Quindi la risposta giusta alla domanda «un utente desktop non può più cambiarli?» è che per
un cliente stanno già dove devono stare, dentro le impostazioni; e chi legge i docs ha ancora
il selettore di lingua sulla pagina. Chi resta scoperto è solo il visitatore desktop
sloggato che gira sul marketing — che è esattamente il caso in cui quei due interruttori
erano rumore, non funzione.
