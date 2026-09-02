# Fix azioni form nel PageModal

Le sezioni impostazioni aperte nel modal ospitano la `+page.svelte` vera senza
cambiare l'URL del browser. I form di quelle pagine usano action relativi
(`?/disconnect`): SvelteKit li risolve contro l'URL corrente, che nella modal
non è mai la rotta ospitata — il POST andava alla pagina sotto e il server
rispondeva 404 "No action with name 'disconnect' found".

Fix a livello di modal, non pagina per pagina (42 action su 21 sezioni
avrebbero avuto lo stesso difetto):

- capture sul submit che riscrive `action`/`formaction` relativi sulla rotta
  ospitata prima che `use:enhance` li legga;
- patch di `fetch` (solo mentre la modal è aperta, solo per POST alla rotta
  ospitata) che applica il risultato a `page.form` via `applyAction`: il
  fallback di SvelteKit salta `applyAction` quando il pathname non coincide,
  e senza quello né i toast né il ricarico della sezione partirebbero.

Scartato il fix pagina per pagina con URL assoluti: anche con l'action giusto
il risultato non sarebbe arrivato a `page.form`, stesso sintomo.
