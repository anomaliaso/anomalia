# La scatola nera dei sotto-agenti si scriveva a vuoto

## Perché

Ogni insert di `saveAgentSession` moriva in produzione con
`null value in column "id" of relation "agent_sessions" violates not-null
constraint` (23502): `agentSessionRow` non produceva `id`, e la migration
0205 definisce la colonna senza default. Gli errori vengono ingoiati di
proposito (la diagnostica non può rompere il turno), quindi il difetto è
stato silenzioso: l'altro writer, `harness/persist.ts`, include `id` nel
proprio snapshot ed è l'unico motivo per cui la tabella non è vuota.
L'intera traccia dei turni delegati dalla chat (comandi sandbox, pagine,
report) non è mai arrivata al database.

## Decisione

- `agentSessionRow` genera il proprio `id` con `crypto.randomUUID()`,
  come già fa il percorso harness. Fix nel codice e non un
  `alter column id set default gen_random_uuid()`: le deploys non girano
  migration, quindi la default sul database avrebbe lasciato il difetto
  in produzione fino a un apply manuale — e il contratto «chi scrive
  porta il suo id» è già il pattern stabilito dall'altro writer.
- Test di regressione sul seam puro (`agentSessionRow`): la riga deve
  portare un uuid valido. Guarda sia la rimozione del campo sia un
  futuro writer che riusa la funzione senza id.

## Scartato

Migration con default sulla colonna: rimanda il fix a un passaggio
manuale su produzione e maschera il contratto invece di dichiararlo.
