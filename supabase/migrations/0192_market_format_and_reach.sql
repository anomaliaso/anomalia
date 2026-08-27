-- 0192: la forma del video e come è arrivato al pubblico.
--
-- Tutto quanto sotto era già nella risposta che paghiamo. È il terzo giro dello stesso errore
-- (region in 0190, url del video e sottotitoli in 0191): il campo c'è, il mapper lo scarta, e la
-- domanda che ci renderebbe utili resta senza risposta perché il dato non è mai atterrato.
--
--   duration_ms        La durata. "In ristorazione i 15 secondi battono i 45?" è la domanda di
--                      formato più azionabile che esista, e senza questa colonna non è nemmeno
--                      formulabile. 20 video su 20 la portano.
--
--   hashtags           Gli hashtag che il post ha DAVVERO usato (da text_extra), non quello che
--                      abbiamo cercato noi. La differenza è tutta: `query` dice cosa cercavamo,
--                      questa dice cosa ha funzionato. È anche l'unica colonna qui che si consegna
--                      a un utente così com'è.
--
--   sound_from         Da dove il creator ha preso l'audio: 'original' contro le varie voci di
--   sound_is_original  ricerca e raccomandazione di TikTok. Misurato su 20: original 6, preso da
--                      ricerca 5, raccomandato 8. Insieme a sound_id è il controllo più affilato
--                      che possiamo avere sulla domanda "è andato virale per il contenuto o per il
--                      suono": un virale su audio raccomandato ha viaggiato su una corrente, e
--                      attribuirlo all'hook sarebbe il modo più diretto di insegnare una bugia.
--
--   created_by_ai      L'etichetta AI di TikTok. Per un tool che genera contenuti con l'AI la
--                      domanda "i contenuti marchiati AI rendono meno?" arriverà dai clienti, e
--                      preferiamo averla già misurata.
--
--   video_ratio/w/h    Qualità di produzione, e verticale contro quadrato.
--   shoot_mode         photo-mode contro video: si comportano in modo diverso e finivano
--                      indistinguibili nello stesso bucket.
--
--   video_url_clean    La copia senza watermark (18 su 20). NON sostituisce media_url: cambiare
--                      la sorgente da cui il giudice scarica, mentre 2 estrazioni su 3 già
--                      falliscono, significherebbe non sapere più quale delle due cose ha rotto.
--                      Colonna a parte, si sceglie dopo, con i numeri.
--
--   watch_*            SEMANTICA NON VERIFICATA, e la colonna lo dice. TikTok espone
--                      solaria_profile.play_time_prob_dist come "[800, 0.7566, 2241.38]" su tutti
--                      i video: la lettura plausibile è soglia in ms, probabilità di superarla,
--                      tempo medio di visione — cioè retention, la metrica che conta più di ogni
--                      altra nello short-form e che sul video di un altro normalmente non si può
--                      avere. Non c'è documentazione a confermarlo. Si salvano i tre numeri grezzi
--                      così come arrivano: se correlano con l'outperformance scopriremo
--                      empiricamente cosa sono, e se non correlano avremo speso tre colonne.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.

alter table public.market_posts
  add column if not exists duration_ms int,
  add column if not exists hashtags text[],
  add column if not exists sound_from text,
  add column if not exists sound_is_original boolean,
  add column if not exists created_by_ai boolean,
  add column if not exists video_ratio text,
  add column if not exists video_width int,
  add column if not exists video_height int,
  add column if not exists shoot_mode text,
  add column if not exists video_url_clean text,
  add column if not exists watch_threshold_ms numeric,
  add column if not exists watch_prob numeric,
  add column if not exists watch_avg_ms numeric;

-- "Quale durata rende, in questa verticale": la query per cui duration_ms esiste.
create index if not exists market_posts_duration_idx
  on public.market_posts (category, duration_ms)
  where duration_ms is not null;

-- "Quanto di questo virale è merito del suono": separare l'audio proprio da quello preso in prestito.
create index if not exists market_posts_sound_origin_idx
  on public.market_posts (sound_is_original, outperformance desc)
  where sound_is_original is not null;

-- Ricerca per hashtag realmente usato — GIN, perché la domanda è "quali post contengono X".
create index if not exists market_posts_hashtags_idx
  on public.market_posts using gin (hashtags)
  where hashtags is not null;
