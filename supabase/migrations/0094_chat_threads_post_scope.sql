-- 0094 Per-post chat threads
--
-- The content editor gets a dedicated chat per post/carousel (behind FEATURE_STUDIO).
-- A thread scoped to a post is just a chat_threads row with post_id set; unscoped
-- (post_id null) rows remain the brand-level conversations of the global chat.

alter table chat_threads
  add column post_id uuid references posts(id) on delete cascade;

-- One editor thread per (brand, user, post). Brand-level threads (post_id null) are
-- unaffected by this partial unique index.
create unique index uniq_chat_threads_post
  on chat_threads(brand_id, user_id, post_id)
  where post_id is not null;

create index idx_chat_threads_post
  on chat_threads(post_id)
  where post_id is not null;
