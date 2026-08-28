# Changelog interno — un file per entry

Il nome file è `YYYY-MM-DD-<slug>.md`: data ISO e slug breve della feature.
Due agenti che lavorano in parallelo aggiungono file diversi e non si scontrano
mai — nessuno modifica mai il file di un altro, né tocca la storia chiusa in
`CHANGELOG.md` (frozen: archivio fino ad agosto 2026).

Dentro il file: titolo `# ` e corpo libero — perché la cosa esisteva, cosa c'era
prima, decisioni prese e scartate. La data sta nel nome del file: non riscriverla
nel corpo, non duplicarla.

Se la modifica è visibile anche agli utenti, lo stesso commit aggiunge il secondo
changelog: un file `YYYY-MM-DD-<slug>.ts` in `src/lib/content/changelog/`,
in inglese, export default di un `ChangelogEntry` — il formato lo dice
`src/lib/content/changelog/index.ts`.
