# Via `settings/autopilot`: era un interruttore già acceso altrove

La pagina esponeva **un** interruttore: l'autopilot acceso o spento. Il criterio è uno —
*una pagina di impostazioni esiste se qualcuno la cambia davvero* — e questa non passa, ma
non perché nessuno la usi: perché lo stesso gesto vive in altri due posti, più completi.

## Cosa scriveva davvero

Il commento dentro `setAutopilot` lo dice: il toggle **non** scriveva più
`brands.autopilot_enabled` (ritirato), ma un rifiuto in `brand_job_optouts` con chiave
`autopilot`. Cioè una riga del roster dei nove lavori ricorrenti.

Quel roster ha già due superfici:

- **`/app/<slug>/agents`**, azione `toggleJob`: la stessa scrittura, per **tutti e nove** i
  lavori, con la cadenza e lo stato accanto. Il commento nel codice lo dichiarava da tempo —
  «questo interruttore e quello sulla pagina /agents devono essere LO STESSO interruttore».
- **`get_automations` / `set_automation`**, appena arrivati su `dev`
  (`packages/api-contracts/src/automations.ts`, endpoint
  `/api/v1/brands/:slug/settings/automations`): l'elenco completo con cadenza, stato, motivo,
  ultimo giro e quante volte ha girato davvero negli ultimi 30 giorni.

Quindi la pagina non era il posto dove si governa l'autopilot: era una copia parziale di una
riga, con meno informazione intorno.

## L'ordine ha contato

La rimozione era pronta e ferma, in attesa che i tool delle automazioni fossero su `dev`.
Ci sono (commit `d57ae3a`, verificato ancestor di `origin/dev` prima di toccare la pagina):
toglierla adesso non lascia nessuno senza il controllo, né una persona né un agente.

## Cosa se ne va con lei

`setAutopilot` in `$lib/server/settings-actions.ts`: era usata solo da quella pagina.
Con lei se ne va l'ultimo import di `setJobEnabled` in quel file — le scritture sul roster
passano ormai tutte da `/agents` e dall'endpoint.

## La regressione che la cancellazione introduceva, chiusa qui

La pagina, riaccendendo, faceva una cosa in più: `autopilot_failure_count: 0`. Il commento
diceva *«Riaccendere azzera anche la serie di fallimenti: il watchdog riparte da zero»*.
`toggleJob` su `/agents` non lo fa, e senza quel reset la cancellazione lasciava dietro un
guasto lento.

Il meccanismo, per intero: lo scheduler conta i giri falliti di fila e alla terza
(`MAX_CONSECUTIVE_FAILURES`) scrive un opt-out `actor: 'watchdog'` sul roster. **Il brand non
resta bloccato in silenzio** — su `/agents` il producer appare spento e si riaccende da lì, che
è proprio come il watchdog è stato progettato. Ma il contatore resta a 3, e la soglia è `>=`:
riacceso, il **primo** fallimento successivo lo rispegne. Un tentativo invece di tre. E
l'avviso «autopilot disattivato» (`warnings.ts`, `brand-doctor.ts`) resta acceso finché un giro
non riesce, quindi il prodotto dice una cosa e il roster ne dice un'altra.

Il reset è finito in **`setJobEnabled`**, non in `toggleJob`. A riaccendere sono due superfici —
la pagina `/agents` e `set_automation` via MCP — ed entrambe passano di lì: una guardia per
ciascuna è la guardia che il terzo chiamante dimentica. Un fallimento del reset viene loggato e
non fa tornare indietro l'interruttore: quello è già scritto, e al peggio il contatore lo azzera
il primo giro riuscito, che è quello che già fa.
