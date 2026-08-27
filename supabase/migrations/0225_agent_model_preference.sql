-- 0225 La preferenza di modello diventa dato, non impostazione di un solo dispositivo.
--
-- La forma è la AgentModelPolicy dei contratti ({ family, thinking }, family = chiave di
-- MODEL_FAMILIES nel catalogo): null = «segui il default» (tier del turno / env).
-- custom_agents.model: la preferenza PERMANENTE dell'agente.
-- chat_threads.model: la preferenza della singola conversazione, che vince sull'agente.
-- Nessuna policy RLS nuova: le tabelle filtrano già per riga e la colonna le eredita.

alter table public.custom_agents add column if not exists model jsonb;
alter table public.chat_threads add column if not exists model jsonb;
