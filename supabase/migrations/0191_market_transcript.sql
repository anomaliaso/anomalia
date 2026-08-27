-- 0191: il parlato del video, e da dove viene.
--
-- TikTok trascrive da sé una parte dei video e consegna il WebVTT nella stessa risposta che già
-- paghiamo — con i timestamp, quindi si legge non solo COSA è stato detto ma cosa è stato detto
-- nei primi tre secondi. Quello è l'hook, ed è la variabile più predittiva dello short-form: la
-- stavamo comprando da un modello multimodale quando in una minoranza di casi era già lì, gratis,
-- in 322 byte e 0,77 secondi.
--
-- `transcript_source` non è decorazione. Una caption automatica di TikTok e una trascrizione di
-- Gemini sono due strumenti con profili di errore diversi: una colonna che li mescola senza dire
-- quale sia quale non permette né di controllare l'uno con l'altro, né di accorgersi che una
-- conclusione poggia tutta su quello più economico. Con la colonna, "questo hook funziona" si può
-- ricalcolare sulle sole trascrizioni Gemini e vedere se regge.
--
-- `hook_spoken` è materializzato invece che ricavato al volo: è la chiave su cui si raggruppa, e
-- ricalcolarlo a ogni query significherebbe riparsare il VTT che non conserviamo.
--
-- media_url si popola anche per le righe da storico profilo. Misurato: 30 video su 30 portano un
-- play_addr, e lo scartavamo — è il motivo per cui i 72 post mega-virali che abbiamo (quelli veri:
-- account normali con un post esploso, il caso più istruttivo che possediamo) erano invisibili al
-- giudice. Nessuna colonna nuova per questo, solo codice che smette di buttare via il campo.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns.

alter table public.market_posts
  add column if not exists transcript text,
  add column if not exists transcript_source text
    check (transcript_source is null or transcript_source in ('captions', 'gemini')),
  add column if not exists transcript_lang text,
  add column if not exists hook_spoken text;

-- "Quali hook parlati ricorrono fra i post che hanno sovraperformato": la query per cui esiste.
create index if not exists market_posts_hook_spoken_idx
  on public.market_posts (outperformance desc)
  where hook_spoken is not null;

-- Leggere il fit attraverso lo strumento: quanto di una conclusione poggia sulle caption gratuite.
create index if not exists market_posts_transcript_source_idx
  on public.market_posts (transcript_source)
  where transcript is not null;
