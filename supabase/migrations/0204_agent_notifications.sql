-- 0204: quando è l'agente a bussare fuori dalla chat.
--
-- Fino a qui ogni email e ogni push partiva da un evento di sistema deciso da noi: post pronti da
-- approvare, crediti quasi finiti, recap del lunedì. L'agente della chat, invece, poteva solo
-- scrivere nel thread — e un thread lo legge chi lo tiene aperto. Con i team ricorrenti e i
-- sotto-agenti che lavorano per minuti (o di notte), "l'ho scritto in chat" vuol dire "non gliel'ho
-- detto".
--
-- `notify_user` gli dà il canale vero: una mail via Resend a TUTTI gli invitati del progetto, più la
-- push sui dispositivi di chi l'ha attivata. Questa tabella esiste perché quel potere va tracciato:
--
-- 1. **Audit.** Una mail partita a nome del brand deve avere un mittente ricostruibile: quale brand,
--    quale thread, quale tool call, con quale testo. Senza questa riga resta solo un log di Resend.
-- 2. **Freno.** Il limite per turno vive nel codice, ma un agente ricorrente gira molti turni: il
--    tetto orario per brand si può calcolare solo da qui (count sull'ultima ora).
-- 3. **Antiduplicato.** Due sotto-agenti che finiscono lo stesso lavoro mandano lo stesso annuncio.
--    Lo stesso oggetto, sullo stesso brand, entro pochi minuti, è un doppione: si riconosce da qui.
--
-- Il log è best-effort di proposito: se questa tabella non c'è ancora, la notifica parte lo stesso e
-- resta in piedi il limite per turno. Ma finché non è applicata, il tetto orario non morde.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.

create table if not exists public.agent_notifications (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- Da quale conversazione è partita. `set null`: la notifica è già stata consegnata, sopravvive
  -- alla cancellazione del thread che l'ha prodotta.
  thread_id uuid references public.chat_threads(id) on delete set null,
  -- L'utente per conto del quale girava il turno (non il destinatario: i destinatari sono tutti i
  -- contatti del brand, ed è il conteggio qui sotto a dirne quanti).
  user_id uuid references auth.users(id) on delete set null,
  tool_call_id text,

  subject text not null,
  body text not null,
  push_body text,
  url text,

  -- Quanti contatti risolti, quante mail effettivamente accettate da Resend, quante push inviate.
  -- Tre numeri distinti perché falliscono in modo distinto: zero push con due mail è normale
  -- (nessuno ha attivato le notifiche), zero mail con due contatti è un incidente.
  recipients integer not null default 0,
  emailed integer not null default 0,
  pushed integer not null default 0,

  created_at timestamptz not null default now()
);

-- L'indice che serve al freno: "quante nell'ultima ora per questo brand".
create index if not exists agent_notifications_brand_idx
  on public.agent_notifications (brand_id, created_at desc);

alter table public.agent_notifications enable row level security;

-- Sola lettura per chi ha accesso al brand: la notifica è un fatto del progetto, non del singolo.
-- La scrittura passa solo dal server (service role), perché è l'agente a produrla.
drop policy if exists "agent_notifications_select" on public.agent_notifications;
create policy "agent_notifications_select" on public.agent_notifications for select
  using (brand_id in (select public.auth_brand_ids()));
