-- La vetrina della chat era un array in un file .ts: un modello uscito stamattina entrava nel
-- menu solo col deploy successivo, e chi gestisce l'istanza non aveva modo di cambiarla senza
-- toccare il codice.
--
-- Qui la vetrina diventa righe. Chi la riempie sono due: l'operatore, a mano, e il cron
-- `/api/v1/chat/models/sync`, che ogni giorno chiede il listino al gateway e aggiunge il modello
-- piu` recente dei vendor che la tabella gia` segue — nuovo vendor mai visto, nessuna riga.
--
-- Cosa NON sta qui: prezzo, nome, finestra di contesto, capacita`. Cambiano ogni settimana e
-- arrivano vivi da /models a ogni lettura. Una riga per un modello che il gateway non serve piu`
-- non rompe niente: sparisce dal menu da sola.
create table if not exists public.chat_model_catalog (
  model_id text primary key,
  enabled boolean not null default true,
  position integer not null default 100,
  source text not null default 'manual' check (source in ('manual', 'auto', 'seed')),
  added_at timestamptz not null default now()
);

alter table public.chat_model_catalog enable row level security;

comment on table public.chat_model_catalog is
  'Vetrina del picker della chat. Ha priorita` su LLM_MODELS e sul fallback nel codice.';

insert into public.chat_model_catalog (model_id, position, source) values
  ('anthropic/claude-opus-5', 10, 'seed'),
  ('anthropic/claude-sonnet-5', 20, 'seed'),
  ('anthropic/claude-haiku-4.5', 30, 'seed'),
  ('openai/gpt-5.6-sol', 40, 'seed'),
  ('openai/gpt-5.6-terra', 50, 'seed'),
  ('openai/gpt-5.6-luna', 60, 'seed'),
  ('google/gemini-3.7-flash', 70, 'seed'),
  ('google/gemini-3.1-pro-preview', 80, 'seed'),
  ('x-ai/grok-4.6', 90, 'seed'),
  ('deepseek/deepseek-v4-flash-vision-exp', 100, 'seed'),
  ('z-ai/glm-5.3-flash', 110, 'seed'),
  ('qwen/qwen3.8-max', 120, 'seed'),
  ('qwen/qwen3.8-flash', 130, 'seed'),
  ('moonshotai/kimi-k3', 140, 'seed'),
  ('meta-llama/llama-4-maverick', 150, 'seed'),
  ('mistralai/mistral-large-2512', 160, 'seed')
on conflict (model_id) do nothing;
