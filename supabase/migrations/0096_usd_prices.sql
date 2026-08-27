-- 0096: Add parallel USD Stripe prices to plan_from_price_id.
-- Visitors outside the eurozone now get dedicated USD prices (Starter $55/$550, Pro $225/$2250)
-- instead of Stripe Adaptive Pricing converting the EUR amount. The DB trigger that derives
-- brands.plan from the active subscription price must recognise these IDs too, so a USD
-- subscriber's plan tier resolves correctly (e.g. on upgrade / webhook re-sync).

create or replace function public.plan_from_price_id(price_id text) returns text
  language sql immutable as $$
  select case price_id
    -- Starter (EUR)
    when 'price_1Tfx7NRxN8PTIw40e2md3XM3' then 'starter'
    when 'price_1Tfx7ORxN8PTIw40zbThuICT' then 'starter'
    -- Starter (USD, $59 current)
    when 'price_1TvzRFRxN8PTIw40BzGorfUx' then 'starter'
    when 'price_1TvzRFRxN8PTIw40RbmFkAyr' then 'starter'
    -- Starter (USD, $55 retired — kept mapped in case of an in-flight checkout)
    when 'price_1TvzFMRxN8PTIw40AwEewfIr' then 'starter'
    when 'price_1TvzFNRxN8PTIw40tkJESrH1' then 'starter'
    -- Pro (EUR)
    when 'price_1TsqcSRxN8PTIw40NwIFR94X' then 'pro'
    when 'price_1TsqcSRxN8PTIw40uJn3KM8f' then 'pro'
    -- Pro (USD)
    when 'price_1TvzFNRxN8PTIw40gBtqI6B2' then 'pro'
    when 'price_1TvzFNRxN8PTIw40dtjNya7c' then 'pro'
    -- Scale (legacy, grandfathered)
    when 'price_1Tfx7PRxN8PTIw402DvZkiFB' then 'scale'
    when 'price_1Tfx7PRxN8PTIw40te7THigm' then 'scale'
    else null
  end;
$$;
