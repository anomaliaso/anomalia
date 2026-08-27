-- 0190: le variabili che dicono PERCHÉ un video è andato virale, non solo QUANTO.
--
-- Un post mega-virale è il caso in cui la domanda "è stato l'hook?" è più interessante e più
-- pericolosa. Con un solo video la risposta non esiste: n=1, nessun controfattuale, e il giudice
-- descriverà un hook con la stessa sicurezza sia che abbia contato sia che non abbia contato
-- niente. Il rischio concreto non è sbagliare — è attribuire all'hook quello che appartiene a
-- qualcos'altro, e poi insegnarlo al planner.
--
-- Queste colonne sono quel "qualcos'altro". Erano già tutte nel payload di ScrapeCreators e le
-- stavamo scartando (le chiamate TikTok passavano `trim=true`, che rimuove proprio music e
-- author):
--
--   region              il paese del creator. Serve a due cose: segmentare, e rendere leggibile
--                       published_at — un orario UTC da solo non dice niente, "le 20:00 in Italia"
--                       sì. Attenzione: è la region di CHI PUBBLICA, non di chi ha guardato.
--   sound_id/sound_name su TikTok il suono è il confondente numero uno. Se quaranta mega-virali
--                       condividono un audio, la causa è l'audio, non l'hook — e senza questa
--                       colonna quella spiegazione è invisibile e l'hook si prende il merito.
--   is_ad / paid        reach comprata. Un virale sponsorizzato non insegna niente sul contenuto.
--   saves               collect_count: salvare costa più di un like ed è il segnale che distingue
--                       "utile" da "divertente" — due cose che il planner deve trattare diverse.
--   caption_language    desc_language, per non confrontare un hook italiano con uno inglese.
--
-- Nessuna di queste costa una chiamata in più: sono nella stessa risposta già pagata.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.

alter table public.market_posts
  add column if not exists region text,
  add column if not exists sound_id text,
  add column if not exists sound_name text,
  add column if not exists is_ad boolean,
  add column if not exists is_paid_partnership boolean,
  add column if not exists saves int,
  add column if not exists caption_language text;

-- "Quale suono sta spingendo la piattaforma adesso": conta i virali per audio.
create index if not exists market_posts_sound_idx
  on public.market_posts (sound_id, outperformance desc)
  where sound_id is not null;

-- Segmentazione per paese e orario, la coppia che rende published_at interpretabile.
create index if not exists market_posts_region_time_idx
  on public.market_posts (region, published_at desc)
  where region is not null;

-- Un virale sponsorizzato va escluso dalle correlazioni sul contenuto, quindi va trovato in fretta.
create index if not exists market_posts_promoted_idx
  on public.market_posts (outperformance desc)
  where is_ad is true or is_paid_partnership is true;
