-- 0207: il pallino "non letto" sui thread della chat.
--
-- Qui i thread non sono solo conversazioni fra persone: gli agenti programmati, gli agenti custom e
-- i team scrivono nel thread MENTRE non c'è nessuno a guardare. Il badge non serve a dire "ti hanno
-- risposto", serve a dire "il tuo agente è tornato con qualcosa mentre eri via" — ed è l'unico modo
-- di accorgersene senza riaprire ogni chat a mano.
--
-- Perché un marcatore e non un contatore: `chat_threads.updated_at` c'è già e viene toccato a ogni
-- messaggio scritto da chiunque. Basta sapere QUANDO quell'utente ha guardato l'ultima volta:
-- non letto = `updated_at > last_read_at`. Una riga per (thread, utente), niente da incrementare,
-- niente da riallineare quando un messaggio viene cancellato o un job muore a metà. Un numero, se
-- mai servisse, si ricava contando i messaggi dopo `last_read_at`.
--
-- Perché per utente e non un flag sul thread: i progetti sono condivisi (membri e inviti, 0077).
-- Due persone sullo stesso brand hanno insiemi di non letti diversi, sempre.
--
-- Tabella nuova e non una colonna su `chat_threads`: le select condivise su quella tabella usano
-- `select('*')` e girano in produzione PRIMA che questa migration venga applicata a mano — una
-- colonna che ancora non esiste farebbe fallire ogni lettura dei thread (già successo una volta).
-- Separata, la lettura del non letto fallisce da sola e degrada a "tutto letto": niente badge,
-- nessun errore.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.

create table if not exists public.chat_thread_reads (
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  -- Fin dove quell'utente ha guardato. Viene avanzato quando il thread è aperto davanti a lui,
  -- e quando è lui a scrivere (chi scrive ha visto tutto quello che c'era prima).
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- La query è sempre "questi N thread, per questo utente": la PK copre il lookup per thread_id,
-- questo indice copre il filtro per utente sulla lista.
create index if not exists chat_thread_reads_user_idx
  on public.chat_thread_reads (user_id, thread_id);

alter table public.chat_thread_reads enable row level security;

-- Lo stato di lettura è privato per definizione: nessuno vede (né muove) il segnalibro di un altro.
drop policy if exists "chat_thread_reads_select" on public.chat_thread_reads;
create policy "chat_thread_reads_select" on public.chat_thread_reads for select
  using (user_id = auth.uid());

drop policy if exists "chat_thread_reads_insert" on public.chat_thread_reads;
create policy "chat_thread_reads_insert" on public.chat_thread_reads for insert
  with check (user_id = auth.uid());

drop policy if exists "chat_thread_reads_update" on public.chat_thread_reads;
create policy "chat_thread_reads_update" on public.chat_thread_reads for update
  using (user_id = auth.uid());

-- Nessun backfill di proposito: senza riga il thread conta come letto, quindi il giorno in cui
-- questa migration viene applicata la sidebar non si accende tutta di storico. Dal momento in cui
-- un thread nasce (createThread scrive qui la sua riga) il conto riparte pulito.
