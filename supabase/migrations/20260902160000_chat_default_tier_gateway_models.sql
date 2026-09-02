-- Il default di modello di un brand poteva essere solo uno dei sei nomi inventati da noi
-- ('auto','fast','pro','deepseek-pro','gpt-terra','gpt-sol'). Ora il picker offre il catalogo del
-- gateway, quindi il valore può essere anche un id di modello — `anthropic/claude-opus-5`.
--
-- Il vincolo resta, e resta stretto: o uno dei preset, o qualcosa che ABBIA LA FORMA di un id
-- (`vendor/modello`). Che quel modello esista davvero lo verifica il server contro il listino
-- vivo, perché è una cosa che cambia ogni settimana e un CHECK non può inseguirla.
alter table public.brands drop constraint if exists brands_chat_default_tier_check;

alter table public.brands add constraint brands_chat_default_tier_check check (
  chat_default_tier is null
  or chat_default_tier in ('auto', 'fast', 'pro', 'deepseek-pro', 'gpt-terra', 'gpt-sol')
  or chat_default_tier ~ '^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._:-]*$'
);
