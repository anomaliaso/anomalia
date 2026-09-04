# Lora sui titoli (esperimento, alternativa a Dark Moon)

Seconda prova di un display face sui titoli. Sorella della PR con Dark Moon
(#279): stessa identica meccanica, font diverso, così si guardano affiancate e
si sceglie vedendo invece che immaginando. Le due si escludono: ne sopravvive
una.

## Cosa c'era prima

Lo stesso di #279. `--serif` governa già i titoli (`h1, h2` in app.css, più una
ottantina di usi fra landing, pagine legali e `PageTopBar`) ma puntava a Inter,
la stessa famiglia di `--sans`: un token che diceva "display" e non faceva
niente. Nessun `--display` nuovo — sarebbe un secondo token per il lavoro che
`--serif` fa già.

## Come è fatto

Due file in `static/fonts/`, `lora-latin.woff2` (37.792 byte) e
`lora-latin-ext.woff2` (20.176 byte), con gli stessi due `unicode-range` di
Inter — che sono poi gli intervalli standard di Google, identici carattere per
carattere a quelli già scritti in app.css.

**Non caricato da Google Fonts.** Il commento accanto a Inter dice già perché
(«No Google Fonts CSS, no italic axis, no unused unicode scripts»): un dominio
in più nel percorso critico e l'IP di ogni visitatore che finisce a Google. I
file arrivano da lì, ma li serviamo noi.

Lora è **variabile sull'asse `wght`, 400–700**. Un file copre tutti i pesi, e
qui il `font-weight` dichiarato è quello vero: niente trucco del range
100–900 che su Dark Moon serviva solo a impedire al browser di inventarsi un
finto grassetto, perché le sottigliezze in Lora ci sono davvero.

Il ripiego resta Inter, non un serif di sistema.

## Licenza — la differenza vera con Dark Moon

**SIL Open Font License 1.1**, dichiarata dentro il font stesso (name ID 13 nel
TTF sorgente, name ID 14 → `scripts.sil.org/OFL` anche nei subset). Copyright
«The Lora Project Authors», Reserved Font Name "Lora".

Si può incorporare e ridistribuire, anche da un repository pubblico. Su Dark
Moon la domanda era aperta e la decisione era di Andrea; qui non c'è domanda.

La OFL chiede che il testo della licenza accompagni il font quando lo si
ridistribuisce, e commettere il woff2 in un repo pubblico è ridistribuzione:
per questo `static/fonts/Lora-OFL.txt` sta accanto ai file e non va tolto
finché ci sono.

## Il test

`src/lib/font-face.test.ts`, **identico a quello di #279**, di proposito: due
file uguali si fondono senza attrito, due file divergenti no — e comunque solo
una delle due PR arriverà in fondo. Verifica che ogni `src: url()` di app.css
esista davvero sotto `static/`, e che `--serif` tenga Inter prima di
`sans-serif`. Le due asserzioni sono già state viste fallire in #279.

## Cosa non è stato verificato

Nessun browser, nessuno screenshot dell'app vera. La verifica che conta è
guardarlo, e la fa Andrea — per questo il dev server resta acceso.

## Il confronto, misurato

|                            | Dark Moon        | Lora                        |
|----------------------------|------------------|-----------------------------|
| Peso sulla pagina tipica   | 39.272 B         | **37.792 B** (solo latin)   |
| Con caratteri latin-ext    | 39.272 B         | 57.968 B                    |
| Pesi reali, senza sintesi  | **1** (solo 400) | **tutti 400–700** (variabile) |
| Licenza                    | ignota, da verificare | **OFL 1.1**            |
| Sotto i 20px               | esile, si assottiglia | tiene                  |
| Carattere                  | editoriale, distintivo | libresco, convenzionale |
| Ingombro orizzontale       | stretto          | **più largo** — i titoli lunghi occupano più riga |

Il caso peggiore è la topbar (0,95rem ≈ 15px, peso 600) ed è dove si separano
di più: Lora ha un semibold vero e resta nero e leggibile, Dark Moon può solo
essere il suo unico Regular e sbianca. In grande il verso si inverte — Dark
Moon ha una personalità che Lora non ha.

Nota su `--heading-weight: 300`: è sotto il minimo di Lora, quindi `h1`/`h2`
vengono resi a 400. Non è un difetto, è il valore più vicino disponibile — ma
i titoli risultano un filo più pieni di oggi. Il knob non è stato toccato:
cambiarlo cambierebbe anche il ramo Inter, e non è questo l'esperimento.
