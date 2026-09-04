# La sidebar: nove righe e l'ingranaggio

Home, Materiali, Strategia, Calendario, SEO/GEO, Auto blog, News Radar, Agenti, Risultati.
Un gruppo solo, senza intestazione: nove voci di pari rango non hanno bisogno di essere
raggruppate, e il gruppo «Strumenti» che ne raccoglieva quattordici non c'è più.

## «Impostazioni» smette di essere una riga

L'ingranaggio in fondo alla barra c'era già, e aveva già il suo nome accessibile —
`aria-label` e `title` in `DashboardSidebar.svelte`, più lo stato `isNavPending`. La voce di
testo era la seconda porta per la stessa stanza. Tolta quella, l'icona resta quella di prima:
nessun componente nuovo, nessun flag `iconOnly`, nessuna accessibilità da rifare.

## Chi resta in barra, e perché non è stato tagliato

Il taglio era partito più largo — cinque righe, come il mockup — e tre voci sono state
rimesse **prima** che la PR entrasse:

- **SEO/GEO** (`/seo`) e **Auto blog** (`/site`) sono le due chieste al posto di «Web», create
  poche ore prima. Toglierle sarebbe stato disfare la richiesta con la mano destra mentre la
  sinistra la eseguiva.
- **Agenti** (`/agents`) è, da quando `settings/autopilot` è stata cancellata, **l'unica
  superficie browser dei nove lavori ricorrenti**. Senza quella riga, chi non ha un agente
  collegato non ha più un modo di spegnere le proprie automazioni. È la stessa forma del
  difetto del contatore di fallimenti: una porta che si chiude e nessuno se ne accorge finché
  non serve.

News Radar sale dagli Strumenti: è l'unica di quelle che si guarda tutti i giorni, e sta
accanto ad Agenti — le due cose che girano da sole, di fila. Ha una chiave nuova
(`app.nav2.newsRadar`): quella vecchia, `app.hub.automations.radar`, dice «Internet Radar» e la
usa ancora la pagina `/automations`, che non va rinominata di rimbalzo.

## Undici destinazioni perdono la riga

`/leads` · `/keywords` · `/backlinks` · `/competitors` · `/campaigns` · `/manual-posting` ·
`/settings/brand` · `/knowledge` · `/ads/social` · `/ads/google` · `/ads/library`

Le pagine esistono, hanno un'etichetta, e si aprono da ⌘K — che dopo la rimozione della modal
elenca *ogni* pagina del brand su disco — e dai link degli agenti. Ma nessuna riga della barra
ci porta, ed è una scelta: una barra deve dire poche cose.

`NAV_TEAM_TOOLS` è diventato `NAV_OFF_SIDEBAR`, che è quello che adesso è: un elenco che non
disegna più niente ma resta l'inventario — `goTargetLabelKey` ci prende le etichette delle
scorciatoie `g <lettera>`, e il test lo confronta con `HUB_TABS`. Una lista chiamata
«Strumenti» che non disegna strumenti è un commento scaduto sotto forma di codice.

## Il test che sorveglia la cosa giusta

Il caso che c'era già — «ogni destinazione dell'inventario resta linkata» — è rimasto **verde**
per tutta la potatura, perché le voci si spostavano solo di lista e l'unione non cambiava.
Corretto, e inutile: quel test **non può vedere una riga che sparisce**.

Quindi adesso ce ne sono due che la vedono: le nove righe in ordine, e gli undici path che
l'hanno persa. Non giudicano, inchiodano. Aggiungere una pagina senza toccare nessuna delle due
liste fa fallire la suite, che è l'unico modo perché la prossima potatura non si porti via
qualcosa in silenzio. Più un terzo, piccolo, che dice a voce alta perché `/agents` è in barra.
