# Fraunces sui titoli (esperimento)

Terzo tentativo di un display face sui titoli, e il primo scelto **misurando**
invece che a occhio. Dark Moon (#279) e Lora (#284) sono stati scartati: un
altro agente ha misurato il rapporto x-height / cap-height dell'immagine di
riferimento e sta a ≈ 0,77 — territorio ITC anni 70-80 (Souvenir, Benguiat,
Windsor). Un Bodoni sta a 0,65, Playfair a 0,72. Lora è un serif contemporaneo
educato, Dark Moon un display ad alto contrasto con un peso solo: nessuno dei
due è in quella famiglia. Fraunces è disegnato esattamente su Windsor/Souvenir/
Cooper.

## Cosa c'era prima

`--serif` governa già i titoli (`h1, h2` in app.css, più una ottantina di usi
fra landing, pagine legali e `PageTopBar`) ma puntava a Inter, la stessa
famiglia di `--sans`: un token che diceva "display" e non faceva niente.
Nessun `--display` nuovo — sarebbe un secondo token per il lavoro che `--serif`
fa già.

## Le manopole, che contano più della scelta del font

Fraunces nasce con quattro assi e **ai valori neutri sembra un altro
carattere**: un serif qualunque, ad alto contrasto, senza niente degli anni 70.
È l'errore che lo fa scartare a chi non lo conosce.

- **`SOFT=100`** e **`WONK=1`** — sono le due manopole del caratterino. A zero
  si spegne. Non le animiamo mai, quindi sono **fissate dentro il file**, non
  lasciate variabili: le lettere sono identiche e il peso si dimezza (sotto).
- **`opsz` resta variabile**, ed è la ragione per cui si sceglie questo font: il
  disegno cambia con la dimensione — robusto e con x-height alta in piccolo,
  delicato in grande. **Non serve una riga di CSS**: `font-optical-sizing` vale
  `auto` di suo e in tutto `src/` nessuno lo tocca (verificato, e nessun
  `font-variation-settings` che lo scavalcherebbe), quindi opsz segue da solo
  il `font-size`.

È `opsz` che risolve il caso critico dove Dark Moon impallidiva: la topbar a
0,95rem ≈ 15px istanzia `opsz=15`, cioè il disegno pensato per quella misura,
e resta nera e leggibile a 400, 500 e 600.

## Il peso, che è il difetto vero

Questo font è grosso, ed è la ragione per cui la scelta potrebbe essere
respinta. I numeri veri, tutti woff2:

| | latin | latin-ext | pagina tipica (solo latin) |
|---|---|---|---|
| 4 assi, come arriva da Google | 124.876 B | 105.320 B | 124.876 B |
| **2 assi, SOFT/WONK fissati** | **63.992 B** | 53.116 B | **63.992 B** |
| Inter, per confronto | 48.432 B | 85.272 B | 48.432 B |

**Fissare SOFT e WONK dimezza il file** (124.876 → 63.992) senza cambiare una
curva: la verifica è nel test qui sotto. Il resto della potatura è la stessa di
Inter — due subset con `unicode-range`, così latin-ext si scarica solo se la
pagina lo usa davvero (le accentate italiane stanno in Latin-1, dentro il file
latin), niente corsivo, niente scritture inutilizzate.

Il risultato è **64 kB sulla pagina tipica contro i 48 di Inter**: +32%, non il
+400% da cui si partiva. Non serve ripiegare su DM Serif Display.

## `--heading-weight` da 300 a 400

Con Fraunces 300 è troppo esile: a 24px le aste si assottigliano e il
caratterino si spegne proprio dove dovrebbe vedersi. Era 300 perché era tarato
su Inter. Le due righe sono adiacenti e marcate: togliendo l'esperimento
tornano insieme.

Non è la manopola `SOFT`/`WONK` a risolverlo — quelle arrotondano i terminali e
scambiano le alternative, non ingrassano le aste. La sottigliezza a 300 è
questione di peso, e il peso si cambia col peso.

## Il test

`src/lib/font-face.test.ts`, identico a quello delle due PR precedenti: ogni
`src: url()` di app.css deve esistere davvero sotto `static/`, e `--serif` deve
tenere Inter prima di `sans-serif`. Entrambe le asserzioni sono già state viste
fallire.

Il fissaggio degli assi è stato verificato a parte, rendendo la stessa stringa
col font originale a `SOFT=100, WONK=1` e col font fissato: le due immagini
sono **identiche pixel per pixel**, e diverse da quella ai valori neutri. Senza
quel controllo il rischio era spedire il font sbagliato — `instancer` avrebbe
potuto fissare i default (`SOFT=0`) invece dei valori scelti, e la differenza
non si vede finché non la si guarda.

## Licenza

**SIL Open Font License 1.1**, dichiarata dentro il font. Copyright «The
Fraunces Project Authors» (github.com/undercasetype/Fraunces). Si può
incorporare e ridistribuire anche da un repository pubblico. La OFL chiede che
la licenza accompagni il font: `static/fonts/Fraunces-OFL.txt` sta accanto ai
file e non va tolto finché ci sono.

## Cosa non è stato verificato

Nessun browser. Il dev server resta acceso su 5199 perché la verifica che conta
è guardarlo.
