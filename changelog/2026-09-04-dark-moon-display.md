# Dark Moon sui titoli (esperimento)

Prova di un display face vero sui titoli, al posto di Inter. È un esperimento —
"proviamo" — non una scelta chiusa: sta in piedi su una riga sola e su una riga
sola si smonta.

## Cosa c'era prima

Lo slot esisteva già. `--serif` è il token che governa i titoli (`h1, h2` in
app.css, più una ottantina di usi fra landing, pagine legali e `PageTopBar`), ma
puntava a Inter: la stessa famiglia di `--sans`, quindi un token che diceva
"display" e non faceva niente. Sotto è rimasta parcheggiata a commento la prova
precedente con Halant, che è esattamente questa forma qui — una riga viva, una
riga commentata.

Per questo non è stato introdotto nessun `--display`: sarebbe stato un secondo
token per il lavoro che `--serif` già fa, e ottanta usi da riscrivere per
rinominarlo.

## Come è fatto

`static/fonts/dark-moon.woff2` — il TTF (154 KB) convertito con `fontTools`,
39 KB, conversione senza perdite, stessi glifi. Nessun subset: il font è già
tutto latino (247 codepoint mappati, zero greco, zero cirillico), un subset
latin scendeva a 31 KB e quegli 8 KB non valgono un passo di build che nessuno
può rifare a memoria fra sei mesi.

Il `@font-face` segue la forma di Inter (self-hosted, `font-display: swap`,
niente Google Fonts) con due differenze volute:

- **Niente `unicode-range`.** A Inter serve per scegliere fra i suoi due file;
  qui il file è uno, e i codepoint che il font non ha cadono da soli sul font
  successivo nello stack.
- **`font-weight: 100 900` su un font che ha un peso solo.** Dichiarare `400`
  farebbe sintetizzare al browser un finto grassetto dove il titolo chiede 600
  — e su un carattere a contrasto alto il finto grassetto impasta le aste.
  Dichiarare tutto il range gli dice che il peso è già coperto: usa l'outline
  vera e non inventa niente.

Il ripiego resta Inter, non un serif di sistema: `--serif: "Dark Moon", "Inter",
…`. Se il woff2 non arriva, i titoli restano quelli di ieri.

## Il test

`src/lib/font-face.test.ts`. Un `@font-face` che punta a un file inesistente non
rompe niente e non si vede: il testo resta leggibile sul ripiego e il font che
avevamo scelto semplicemente non arriva mai. Il test verifica che ogni `src:
url()` di app.css esista davvero sotto `static/`, e che `--serif` tenga Inter
prima di `sans-serif`. Entrambe le asserzioni sono state viste fallire — path
storpiato e Inter sostituito da Georgia — prima di essere lasciate verdi.

## Cosa non è stato verificato

Il font non è stato visto nel prodotto: niente dev server, niente browser. La
verifica che conta qui è guardarlo, e la fa Andrea. Quello che è stato
controllato è che il file ci sia, che il percorso sia giusto e che il ripiego
sia dichiarato.

## Dove fermarsi, se resta

Dark Moon è un serif editoriale a contrasto alto: regge bene in grande, si
assottiglia sotto i ~20px. Due posti in cui `--serif` lo porta dove
probabilmente non lo vogliamo:

- **`.page-topbar-title`** (`PageTopBar.svelte`) — 0.95rem, ~15px, peso 600. Il
  titolo di pagina della top bar è piccolo e permanente: è il caso peggiore per
  questo carattere.
- **Le pagine legali** (privacy, terms, cookies) — pile di `h2` a 20px, dove il
  registro editoriale non aggiunge niente e la leggibilità perde.

Non sono stati esclusi apposta: l'esperimento serve a vederlo ovunque prima di
decidere dove toglierlo, e ogni esclusione scritta adesso sarebbe una riga in
più da rimuovere dopo.
