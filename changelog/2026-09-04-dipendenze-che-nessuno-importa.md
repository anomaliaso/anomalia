# Sette dipendenze che nessun file importa

`package.json` da 87 a 80 pacchetti diretti; 85 righe fra manifest e lockfile.

## Cosa spariva

| pacchetto | perche' |
| --- | --- |
| `@ai-sdk/xai` | zero occorrenze nel repo, in qualunque forma |
| `@ai-sdk/google` | citato solo in **tre commenti** che raccontano un incidente di risoluzione; Gemini si usa via `@google/genai`, che e' un altro pacchetto |
| `@tiptap/extension-link` | dipendenza transitiva di `@tiptap/starter-kit`, mai importata a mano |
| `@tiptap/extension-underline` | idem |
| `@tiptap/extension-table-cell` | `@tiptap/extension-table` si porta dentro `cell`, `header`, `row` e `kit` come sottopercorsi propri |
| `@tiptap/extension-table-header` | idem |
| `@tiptap/extension-table-row` | idem |

L'unico file che usa TipTap e' `src/lib/components/blog/BlogEditor.svelte`, e importa
quattro cose: `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/extension-image`,
`@tiptap/extension-table`. Tutte e quattro restano.

## Come ho provato che erano morte

1. `git grep` di ogni nome di pacchetto **fra virgolette** (la forma con cui compare in
   un import o in un `require`) su tutti i file di testo tracciati, escludendo
   `package.json` e i lockfile. Sette pacchetti a zero.
2. Scansione di **tutto `node_modules`** per trovare chi li dichiari fra le proprie
   `dependencies` o `peerDependencies`: nessuno. Nessun harness, nessun sandbox, nessun
   provider li tira dentro.
3. Dopo `npm install`, `require.resolve` su ogni pacchetto TipTap che il codice importa
   davvero: tutti ancora risolvibili. `extension-link` e `extension-underline` restano
   installati perche' `starter-kit` li dichiara.

## Cosa sembrava morto e resta

Queste hanno zero import ma **non** sono morte, ed e' importante non riprovarci:

- `@internationalized/date` — `peerDependency` di `bits-ui`.
- `@tiptap/pm` — `peerDependency` di `@tiptap/core`.
- `unzipper` — `peerDependency` **opzionale** di `markitdown-ts`: installata di
  proposito perche' abilita l'estrazione di un formato. Toglierla non romperebbe la
  build, spegnerebbe una funzione in silenzio — che e' peggio.
- `patch-package` — la lancia lo script `postinstall`.
- `@types/node`, `@types/react`, `@types/react-dom`, `@types/turndown`, `@types/web-push`
  — TypeScript li carica per nome, non per import.
- `tailwindcss`, `tw-animate-css` — importati da `src/lib/styles/tailwind.css`, non da
  un `.ts`.

Il censimento «zero stringhe nel codice» da solo avrebbe cancellato tutte e otto queste:
un peer dichiarato, un tipo ambientale e un import CSS non si vedono da un grep sui `.ts`.
