-- 0132: Go plan repriced to €25 / $29 (annual = ×10).
-- Keep the previous €29/$33 price ids mapped so any in-flight checkout still resolves to 'go'.

create or replace function public.plan_from_price_id(price_id text) returns text
  language sql immutable as $$
  select case price_id
    -- Go (EUR €25 / €250 — current)
    when 'price_1U1Li6RxN8PTIw40wpOkPdVy' then 'go'
    when 'price_1U1Li7RxN8PTIw40r1ESOfKs' then 'go'
    -- Go (USD $29 / $290 — current)
    when 'price_1U1Li7RxN8PTIw40cSQTHgoa' then 'go'
    when 'price_1U1Li7RxN8PTIw40DS8GpdHG' then 'go'
    -- Go (EUR €29 / €290 — retired)
    when 'price_1U1KdNRxN8PTIw40JHmOKulo' then 'go'
    when 'price_1U1KdORxN8PTIw40SzNLcZUU' then 'go'
    -- Go (USD $33 / $330 — retired)
    when 'price_1U1KdORxN8PTIw40rVoQwxCs' then 'go'
    when 'price_1U1KdORxN8PTIw40d9QH6CTU' then 'go'
    -- Starter (EUR)
    when 'price_1Tfx7NRxN8PTIw40e2md3XM3' then 'starter'
    when 'price_1Tfx7ORxN8PTIw40zbThuICT' then 'starter'
    -- Starter (USD, current TwI*)
    when 'price_1TwIisRxN8PTIw40DO1gzGRn' then 'starter'
    when 'price_1TwIkiRxN8PTIw4069cfBSqj' then 'starter'
    -- Starter (USD, $59 Tvz*)
    when 'price_1TvzRFRxN8PTIw40BzGorfUx' then 'starter'
    when 'price_1TvzRFRxN8PTIw40RbmFkAyr' then 'starter'
    -- Starter (USD, $55 retired)
    when 'price_1TvzFMRxN8PTIw40AwEewfIr' then 'starter'
    when 'price_1TvzFNRxN8PTIw40tkJESrH1' then 'starter'
    -- Pro (EUR)
    when 'price_1TsqcSRxN8PTIw40NwIFR94X' then 'pro'
    when 'price_1TsqcSRxN8PTIw40uJn3KM8f' then 'pro'
    -- Pro (USD, current TwI*)
    when 'price_1TwIkiRxN8PTIw40pHJIw9YA' then 'pro'
    when 'price_1TwIkjRxN8PTIw40mkrp09Hn' then 'pro'
    -- Pro (USD, older Tvz*)
    when 'price_1TvzFNRxN8PTIw40gBtqI6B2' then 'pro'
    when 'price_1TvzFNRxN8PTIw40dtjNya7c' then 'pro'
    -- Scale (legacy, grandfathered)
    when 'price_1Tfx7PRxN8PTIw402DvZkiFB' then 'scale'
    when 'price_1Tfx7PRxN8PTIw40te7THigm' then 'scale'
    else null
  end;
$$;
