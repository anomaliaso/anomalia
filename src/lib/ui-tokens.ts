/**
 * I design token REALI dell'app — i nomi, non i valori. La fonte dei valori resta
 * `src/app.css` (:root chiaro + :root[data-theme="dark"]); questo file è l'elenco
 * tipizzato di ciò che esiste davvero, così `var(--surface-2, #fff)` — un token che
 * non esiste da nessuna parte, spedito stamattina con fallback bianco su tema scuro —
 * diventa un errore di test invece che un bug in produzione.
 *
 * Per chi scrive UI nuova:
 * - usa SOLO nomi presenti qui (o token davvero definiti nel tuo file/pagina);
 * - se aggiungi un token in app.css, aggiungilo anche qui (il test `ui-tokens.test.ts`
 *   fallisce finché i due elenchi non coincidono);
 * - un token locale di pagina va DEFINITO (`--mio-token: …`) prima di usarlo, mai
 *   lasciato vivere solo dentro il fallback di var().
 */
export const UI_TOKENS = [
  '--accent',
  '--accent-2',
  '--accent-2-rgb',
  '--accent-ink',
  '--accent-rgb',
  '--accent-solid',
  '--amber',
  '--content-max',
  '--content-pad-bottom',
  '--content-pad-top',
  '--content-pad-x',
  '--control-h',
  '--dark',
  '--ease',
  '--heading-tracking',
  '--heading-weight',
  '--ink',
  '--ink-faint',
  '--ink-soft',
  '--invert-surface',
  '--line',
  '--line-2',
  '--mono',
  '--page-sub-size',
  '--page-title-bar-size',
  '--page-title-bar-sub-size',
  '--page-title-line',
  '--page-title-size',
  '--page-title-tracking',
  '--page-title-weight',
  '--paper',
  '--paper-2',
  '--paper-3',
  '--pixel-blue',
  '--pixel-orange',
  '--pixel-pink',
  '--pixel-yellow',
  '--pop',
  '--pop-rgb',
  '--sans',
  '--serif',
  '--shell-top-h',
  '--sidebar-bg',
  '--sidebar-line',
  '--sidebar-w'
] as const;

export type UiToken = (typeof UI_TOKENS)[number];
