-- Images attached to a chat turn. The user message only kept "[N image(s) attached]" as text, so
-- reopening a thread lost the pictures entirely. Stores public media-bucket URLs (uploads arrive as
-- data: URLs and picked library images as signed URLs — both are copied to the bucket at send time,
-- so nothing here expires).
alter table public.chat_messages
  add column if not exists attachments jsonb;
