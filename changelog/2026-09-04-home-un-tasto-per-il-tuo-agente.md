# La home dice il prodotto in meno pagina, e il tasto copia le istruzioni vere

La home era già passata al bring-your-own-AI. Restava lunga: hero, tre lavori,
una sezione a prosa sul "costruirtelo da solo", un confronto agenzia/AI, i canali,
Why us, prezzi, FAQ. Due sezioni dicevano la stessa cosa in due registri diversi —
la prosa e il confronto — e la pagina si leggeva in due respiri invece che in uno.

Ora le due sono una sola: **Costruiscilo / Collegalo**, due colonne con la stessa
forma delle schede di confronto di `/grow`, e sotto ciascuna la riga che è tutto
l'argomento — *«Settimane. Poi manutenzione, per sempre.»* contro *«Un comando.
Oggi.»*. È il secondo argomento del prodotto (la velocità: costruirsi
l'infrastruttura contro trovarsela pronta) detto una volta sola, dove si vede.

## Il tasto

«Connetti a Claude» apriva una modale con tre passi e due tab. Al suo posto c'è un
tasto piccolo che copia negli appunti **le istruzioni da dare al proprio agente**:
cos'è Anomalia, il comando `claude mcp add`, il plugin, il JSON per qualunque host
MCP, l'OAuth e le prime chiamate da fare. Il gesto centrale della home è quello, e
un agente che riceve quel testo arriva a fare qualcosa senza altre istruzioni.

Il testo sta in `src/lib/agent-instructions.ts` e **resta in inglese in tutte le
lingue**: è un prompt per una macchina, non copy della pagina, e tradurre dei
comandi di shell è un modo di romperli. I comandi non sono inventati — vengono da
`cli/skills/anomalia/references/mcp.md`, da `cli/plugins/anomalia/.mcp.json` e
dalla guida in-app `src/routes/v2/[brand]/McpGuide.svelte`. `mcp.anomalia.so`
risponde: `/health` 200, `/mcp` 401 senza Bearer, che è la risposta giusta per un
server MCP con OAuth.

Il ripiego quando la clipboard non c'è (fuori da https il browser la nega) non è
muto: il testo compare sotto il tasto, in un blocco selezionabile. Un tasto che
non dà riscontro lo si preme tre volte, quindi l'etichetta cambia in «Copiato».

`ConnectClaudeDialog.svelte` è cancellato con le sue ~40 chiavi per lingua.

## Le lingue

La PR precedente diceva di aver riscritto tutte e quattro le lingue. Non era vero:
**es.json e fr.json avevano l'inglese dentro** — hero, tre lavori, canali e tutte
le FAQ. Chi apriva `/es` o `/fr` leggeva una home in inglese con il menu tradotto.
Sistemato qui insieme al resto: 29 stringhe per lingua.

## Ads

Restano in home come terzo lavoro, ma la riga dice che lanciare le campagne si
attiva con il team — `ADS_SELF_SERVE` è `false` e le pagine ads mostrano un
placeholder «prenota una call». Prometterle self-serve significa un click che non
porta da nessuna parte.

## Il test della navbar diceva la regola di ieri

`tests/e2e/landing.spec.ts:13` teneva la CI rossa su `dev`, e non per colpa di una
PR. Il commit `24848113` («Drop theme, language and sign-in from the desktop nav»)
ha tolto il link testuale «Sign in» da `nav-right` — decisione presa apposta, con il
costo scritto nel corpo: *«the door is labelled "Get started", so a returning
customer has to infer it»*. Ha spostato tutto nel drawer, ha ripulito il CSS morto,
e ha lasciato l'asserzione dov'era: un comportamento sotto guardia cambiato senza
toccare la guardia.

Andrea ha confermato la decisione — la CTA resta il bottone, il link testuale
accanto non torna. Quindi cede il test, non il codice, e cede **il nome insieme
all'asserzione**: il nome è quello che il prossimo legge per capire se un
cambiamento è una regressione o una scelta.

    the desktop bar offers sign-in as its own link, not folded into the CTA   ← ieri
    sign-in lives in the drawer, and the CTA is the door on desktop           ← oggi

Il costo che il commit accetta ora vive nel nome di un test, non solo in un messaggio
di commit che nessuno rilegge.

Il terzo test — l'accesso dentro il menu a 390px — resta identico, ed è il pezzo che
conta di più adesso: con la barra desktop a tre controlli **il drawer è l'unica porta
esplicita al login**. Verificato che morda davvero: tolto il link dal drawer, quel
test fallisce.

## Quello che la home ora contraddice, in `/pricing`

Non è stato toccato — vale una passata sua — ma va detto:

- `pricing.hero.title` = *«Your social media, on autopilot.»* e
  `pricing.plans.pro.tagline` = *«The full autonomous manager.»* vendono il
  prodotto che la home ha smesso di vendere.
- `pricing.plans.starter.highlights` promette *«Meta & Google Ads — you approve
  spend»* senza dire che si attiva con il team, mentre la home lo dice.
- `pricing.plans.pro.highlights` dice *«Autopublish to 8 social accounts»*: le
  piattaforme sono nove (`PLATFORM_KEYS`), ed è la lista da cui la home genera la
  striscia dei canali.
