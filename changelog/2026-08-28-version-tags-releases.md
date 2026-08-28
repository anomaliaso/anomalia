# Versioni, tag e release — automatici

Prima: la versione in `package.json` era decorativa (`0.2.0` mai taggato),
`scripts/release.mjs` alzava il numero e *stampava* i comandi di tag/push come
passo manuale finale, e l'identità release `<semver>+<build>` esisteva solo per
il benchmark (`src/lib/release.ts`). Nessuna GitHub Release dell'app, solo i
tag `cli-v*` della CLI.

Ora: il merge su main è l'unico trigger. Il workflow `release.yml` confronta la
versione di `package.json` con i tag `v*`: se manca il tag, lo crea e pubblica
la GitHub Release. Se c'è già, il push passa senza fare nulla — la maggioranza
dei merge non è una release, e il check è idempotente (rilanciare non duplica).

Decisioni:

- **Il bump vive nella PR di release (dev→main), non nei PR verso dev.** Con
  molti PR su dev, chiedere un bump a ognuno è cerimonia per null'a; la PR che
  mette insieme la release è dove la decisione "minor o patch" si prende comunque.
- **Le note vengono dai `changelog/YYYY-MM-DD-*.md` aggiunti** tra l'ultimo tag
  e HEAD, nuove entry prima. Estrarre il testo dagli `.ts` pubblici col regex
  era più fragile e menzognero (lì c'è il testo per i clienti, non per chi
  revisiona il repo); i soggetti dei commit sono il fallback, il primo release
  prende le 20 entry più recenti.
- **`v*` e `cli-v*` restano mondi separati**: `release.yml` filtra su `v*`,
  `cli-release.yml` su `cli-v*` — nessuno dei due tocca l'altro.
- **Il build è lo SHA completo**, iniettato a build time come `__BUILD_SHA__`
  (Vercel/Actions lo dicono in env, in locale risponde git, senza git `dev`).
  La forma corta è scelta di presentazione, non di stoccaggio — come già fa
  `releaseLabel()`. Esposto da `GET /api/v1/version` insieme a versione e
  release composta, pubblico e senza auth: non c'è nulla da proteggere.

Le note in locale si vedono con la stessa fonte del workflow:
`node scripts/release-notes.mjs <ultimo-tag> HEAD`.
