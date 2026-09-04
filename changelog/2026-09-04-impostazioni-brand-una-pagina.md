# Le impostazioni del brand diventano una pagina sola

Quattro rotte — `settings/platforms`, `settings/hashtags`, `settings/voice-examples`,
`settings/timezone` — diventano quattro sezioni di `settings/brand`.

## Perché proprio queste quattro

Non è un raggruppamento a gusto: è **l'oggetto che il contratto dichiara già**.
`get_brand_settings` / `set_brand_settings` (`packages/api-contracts/src/brand-settings.ts`,
mergiato in #277) restituiscono **un** oggetto con `timezone`, `platforms`, `hashtags`,
`voice_examples`. Finché il browser ne mostrava quattro pagine e l'MCP un oggetto, citare il
contratto era una coincidenza, non una fonte comune.

Tre delle quattro non erano nemmeno pagine: erano involucri di sei righe attorno a
`StudioPage.svelte`, che rende una sezione per volta. La quarta, il fuso, era trentuno righe con
un `<select>` dentro.

## Come, senza rompere un componente da 1.296 righe

`StudioPage` accetta adesso **una sezione o un elenco**. Le sette sezioni erano una catena
`{#if}/{:else if}` chiusa da un `{/if}`: sono diventate sette blocchi `{#if}` indipendenti — sette
parole cambiate, non una ristrutturazione — e la scelta passa da `section === 'x'` a
`shows('x')`. Escono nell'ordine in cui stanno scritte nel file, non in quello dell'array: un
ordine di lettura non lo decide chi chiama.

La strada che non richiedeva di toccare il componente era montarlo quattro volte. Scartata: ogni
istanza costruisce un client Supabase del browser (`createSupabaseBrowserClient()` a riga 244,
che ne crea uno nuovo a ogni chiamata) e apre la sua sottoscrizione a `data.deferred`. Quattro
client per una pagina di impostazioni non si pagano per risparmiare sette parole.

Il fuso resta fuori da `StudioPage`, in `BrandTimezone.svelte`: non descrive il brand, descrive
**quando** lavora, e non è una sezione dello Studio. Sta nella stessa pagina perché è così che il
contratto lo raggruppa.

## La frase che separa chi sa da chi crede di sapere

La pagina adesso dice, sopra il selettore:

> Cambiare fuso NON sposta i post che hanno già un orario: partono nello stesso istante
> assoluto, quindi cambia la loro ora locale. Solo le programmazioni nuove usano il fuso nuovo.

È la stessa di `set_brand_settings`, e la ragione è nello schema: `posts.scheduled_for` è
`timestamptz`, e la conversione locale→UTC avviene **una volta sola**, quando la riga viene
scritta. Senza quella frase, chi cambia fuso crede di aver spostato il calendario.

`setTimezone` valida già con `isKnownTimezone` (`$lib/brand-fields.ts`): il difetto per cui
accettava qualunque stringa non vuota era già stato chiuso, e non è stato reintrodotto.

## Tre link a rotte cancellate, trovati prima che diventassero 404

È il modo in cui una cancellazione si trasforma in un guasto che nessun test di import vede: il
link è una stringa.

- `warnings.ts` → l'avviso «nessuna piattaforma» puntava a `/settings/platforms`;
- `warnings.ts` → il suggerimento sugli hashtag puntava a `/settings/hashtags`;
- `studio/platforms`, `studio/hashtags`, `studio/voice-examples` → tre rimandi 308 legacy.

Tutti e cinque adesso portano a `/settings/brand#<sezione>`. Nei rimandi la query va **prima**
del fragment (`?qs#hashtags`, non `#hashtags?qs`), o il `#` si porta dentro la query — c'è un
test anche per quello, perché è il genere di dettaglio che si scrive giusto una volta e si
sbaglia la seconda.

## Cosa resta fuori

Il kit del brand (logo, colori, tono) resta in cima alla pagina: il contratto non lo porta —
quello è `update_brand_kit` — ma è il brand prima ancora di come lavora, e stava già lì.
