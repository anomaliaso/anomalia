# Il presidio che accende la RLS entra in una migrazione

`public.rls_auto_enable()` e il suo event trigger `ensure_rls` accendono la row level security su
ogni tabella nuova di `public`. Erano stati creati a mano in produzione e non stavano in nessuna
migrazione, e questo costava due volte:

- **`npm run db:migrate` moriva su un database pulito.** `20260905120000_secdef_least_privilege.sql`
  fa `revoke execute on function public.rls_auto_enable()`, e su un database che non ha la funzione
  Postgres risponde `42883 — function public.rls_auto_enable() does not exist`. La migrazione gira
  dentro una transazione per file, quindi non si rompeva solo quella riga: si fermava la catena.
- **Un ambiente nuovo nasceva senza il presidio.** Che è il costo peggiore, perché non fa rumore:
  ogni tabella creata dopo resta senza RLS finché qualcuno non se ne accorge leggendo `pg_class`.

Il corpo è quello di produzione meno quattro condizioni impossibili — chiesto `schema_name = 'public'`,
i confronti con `pg_catalog`, `information_schema`, `pg_toast%` e `pg_temp%` non possono essere veri.
`create or replace` lo rende un nulla di fatto dove la funzione esiste già, e `create event trigger`
non ha un `if not exists`, quindi il trigger passa da una guardia su `pg_event_trigger`.

**Come è saltato fuori.** Non da un test: da un agente che stava lavorando sullo storage e ha visto
il proprio banco di prova morire lì mentre ricostruiva un database da zero. La suite non poteva
vederlo — gira su Supabase mockato, dove nessuna migrazione viene applicata davvero.

**Verificato su Postgres vero**, database usa e getta dentro il container self-host:

```
ROSSO  revoke su un db senza la funzione   ERROR: function public.rls_auto_enable() does not exist  (exit 3)
VERDE  il blocco nuovo                     CREATE FUNCTION / DO / REVOKE                            (exit 0)
       rigirato una seconda volta          idem, nessun errore
       create table public.probe_nuova     relrowsecurity = t
       grant residui                       anon f, authenticated f
       event trigger ensure_rls            1, non 2
```
