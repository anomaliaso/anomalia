-- ⚠️  NON APPLICARE QUESTO FILE COSÌ COM'È (verificato 2026-08-22).
--
-- Non è mai stato applicato, e nel frattempo la funzione VIVA in produzione è andata avanti per
-- conto suo: `plan_pro_199`, `usd_prices`, `clear_plan_on_cancel`, `go_plan_prices`,
-- `go_plan_prices_25` sono stati applicati a mano via MCP fra il 13/07 e il 06/08, senza un file
-- qui dentro. Questo file è stato scritto il 07/08 sul corpo di 0075, cioè su una versione che in
-- produzione non esisteva più da un mese.
--
-- `create or replace function` sostituisce il CORPO INTERO: applicarlo aggiunge tre mappature
-- giuste (il €69 custom, la coppia Pro EUR 149/1490) ma CANCELLA dieci mappature che oggi ci sono,
-- fra cui tre prezzi ancora attivi su Stripe (Starter USD 59/mese e 590/anno, Pro USD 2250/anno).
-- Nessun abbonamento vivo li usa oggi, quindi nessun cliente cambierebbe piano all'istante — ma un
-- checkout futuro su quei prezzi tornerebbe a risolvere il tier da `metadata.plan`.
--
-- La strada sicura è una migration NUOVA che parta da
--   select pg_get_functiondef('public.plan_from_price_id(text)'::regprocedure);
-- e ci aggiunga sopra le mappature qui sotto. Vedi src/lib/server/stripe.ts (LEGACY_PRICE_TO_PLAN),
-- che nel frattempo tiene la stessa mappa in TypeScript ed è testata.
--
-- 0141: map the custom/current prices that plan_from_price_id still returns NULL for.
--
-- Why this matters: the 0075 trigger derives brands.plan from the active price and falls back to
-- subscription metadata ONLY when the price is unknown. Five of the seven active prices were
-- unmapped, so most brands' tier was decided by metadata — and any stray metadata write (e.g. the
-- pre-confirmation write that /upgrade used to do) silently changed a brand's plan while the
-- customer kept paying the old price. Mapping the prices closes that path.
--
-- The €39/month (price_1TeCKo…) and €1990/year (price_1TeCLE…) legacy prices are deliberately left
-- out: their tier is not established. They keep using the metadata fallback until confirmed.

create or replace function public.plan_from_price_id(price_id text) returns text
  language sql immutable as $$
  select case price_id
    -- Go
    when 'price_1U1Li6RxN8PTIw40wpOkPdVy' then 'go'
    when 'price_1U1Li7RxN8PTIw40r1ESOfKs' then 'go'
    when 'price_1U1Li7RxN8PTIw40cSQTHgoa' then 'go'
    when 'price_1U1Li7RxN8PTIw40DS8GpdHG' then 'go'
    -- Starter (EUR / USD)
    when 'price_1Tfx7NRxN8PTIw40e2md3XM3' then 'starter'
    when 'price_1Tfx7ORxN8PTIw40zbThuICT' then 'starter'
    when 'price_1TwIisRxN8PTIw40DO1gzGRn' then 'starter'
    when 'price_1TwIkiRxN8PTIw4069cfBSqj' then 'starter'
    -- Starter on a custom €69/month price (severoricami, kbpropertymanager)
    when 'price_1TvbGhRxN8PTIw40xteLL5PM' then 'starter'
    -- Pro (current EUR / USD, plus the older EUR pair still on active subscriptions)
    when 'price_1TsqcSRxN8PTIw40NwIFR94X' then 'pro'
    when 'price_1TsqcSRxN8PTIw40uJn3KM8f' then 'pro'
    when 'price_1TwIkiRxN8PTIw40pHJIw9YA' then 'pro'
    when 'price_1TwIkjRxN8PTIw40mkrp09Hn' then 'pro'
    when 'price_1Tfx7ORxN8PTIw40yzeFOYaT' then 'pro'
    when 'price_1Tfx7ORxN8PTIw40z42s8aLo' then 'pro'
    -- Scale (legacy tier, still billed)
    when 'price_1Tfx7PRxN8PTIw402DvZkiFB' then 'scale'
    when 'price_1Tfx7PRxN8PTIw40te7THigm' then 'scale'
    else null
  end;
$$;
