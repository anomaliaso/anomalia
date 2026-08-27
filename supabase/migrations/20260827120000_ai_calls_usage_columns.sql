-- Le otto colonne che `logAiCall` scrive da sempre e che nessuna migration ha mai creato: in
-- produzione sono state aggiunte a mano, quindi il buco si vede solo installando da zero. Lì ogni
-- riga viene rifiutata («Could not find the 'cached_tokens' column of 'ai_calls'») e il rifiuto è
-- un console.warn: l'app funziona e il conto di quanto costa non esiste.
--
-- `if not exists` ovunque: su produzione questa migration non cambia niente.

alter table public.ai_calls
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer,
  add column if not exists cached_tokens integer,
  add column if not exists thinking_tokens integer,
  add column if not exists service_tier text,
  add column if not exists user_id uuid,
  add column if not exists thread_id uuid,
  add column if not exists context text;
