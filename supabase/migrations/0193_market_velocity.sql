-- 0193: la velocità fra due avvistamenti, al posto di una normalizzazione che non può scattare.
--
-- `engagement_at_ref` doveva togliere il confondente dell'età interpolando ogni post a 24 ore.
-- Dopo migliaia di righe è a ZERO, e non per un bug: `engagementAtAge` pretende osservazioni A
-- CAVALLO delle 24 ore — una quando il post era più giovane e una quando era più vecchio — mentre
-- ogni post che vediamo è già maturo quando lo vediamo. I feed trending restituiscono roba di
-- giorni o mesi (una del 26 giugno), e le righe da storico sono filtrate a MATURE_AGE_HOURS = 48
-- per costruzione. La prima osservazione è sempre oltre le 24 ore, quindi il valore è sempre null.
--
-- La cosa importante è che il confondente che quella macchina doveva togliere in gran parte NON
-- C'È: se tutto ciò che teniamo è assestato, confrontare un post di due mesi con uno di sei su
-- engagement finale è legittimo. Era una difesa contro un problema che questa banca dati non ha.
--
-- Quello che invece possiamo misurare, e che le 520 osservazioni già raccolte rendono possibile
-- oggi, è quanto un post stava ANCORA correndo fra due avvistamenti. Un post che in dodici ore
-- guadagna mille interazioni e uno fermo hanno lo stesso engagement finale e non sono la stessa
-- cosa: il primo era ancora in distribuzione quando l'abbiamo guardato, e la sua outperformance è
-- una sottostima.
--
-- `engagement_at_ref` resta in tabella e resta null. Toglierla costerebbe una migrazione
-- distruttiva per recuperare una colonna vuota; il commento qui sotto è l'unica cosa che serve
-- perché nessuno la legga aspettandosi un numero.
comment on column public.market_posts.engagement_at_ref is
  'INERTE per costruzione: richiede osservazioni a cavallo di REFERENCE_AGE_HOURS, e ogni post entra in banca già maturo. Vedi 0193. Usare velocity_per_hour.';

alter table public.market_posts
  add column if not exists velocity_per_hour numeric,
  add column if not exists velocity_measured_at timestamptz;

-- "Quali post stavano ancora correndo quando li abbiamo visti": la lettura per cui esiste.
create index if not exists market_posts_velocity_idx
  on public.market_posts (velocity_per_hour desc)
  where velocity_per_hour is not null;
