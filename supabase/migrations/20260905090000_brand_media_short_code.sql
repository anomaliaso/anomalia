-- Short, stable, shareable codes for brand_media, behind /a/<code>.
--
-- Why a code and not the uuid: these URLs travel through the output of external agents, get
-- copied by hand and read aloud. A signed storage URL is ~600 chars and breaks three ways —
-- it expires in 2h, it truncates in transit (observed: InvalidJWT "signature verification
-- failed" from a clipped token), and nothing about it tells a reader whether it is shareable.
-- The uuid would fix expiry but not length.
--
-- Why generated in the DATABASE and not in insertBrandMedia: six call sites insert media, plus
-- whatever was created out-of-band before this table had a migration. A column default plus a
-- trigger gives every path a code for free, and the backfill below is the same expression.
--
-- Alphabet: 32 chars with no 0/O and no 1/I/L confusion (uppercase only, digits 2-9). At 8
-- characters that is 32^8 ≈ 1.1e12 codes. Andrea chose PUBLIC access — whoever holds the link
-- may read the file — so this length IS the security boundary: it is what stands between a
-- scanner and someone else's asset. Do not shorten it. There is no reason to lengthen it while
-- the library is this size.
create or replace function public.gen_media_short_code() returns text
  language plpgsql volatile as $$
declare
  _alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  _code text;
  _i integer;
begin
  loop
    _code := '';
    for _i in 1..8 loop
      _code := _code || substr(_alphabet, 1 + floor(random() * 32)::integer, 1);
    end loop;
    -- The unique index is the real guard; this check just keeps the insert from failing on the
    -- birthday case instead of quietly retrying.
    exit when not exists (select 1 from public.brand_media where short_code = _code);
  end loop;
  return _code;
end; $$;

alter table public.brand_media
  add column if not exists short_code text;

-- Backfill before the unique index, so existing rows get a link too: a media created yesterday
-- is exactly as shareable as one created after this migration.
update public.brand_media
  set short_code = public.gen_media_short_code()
  where short_code is null;

create unique index if not exists brand_media_short_code_key
  on public.brand_media (short_code);

alter table public.brand_media
  alter column short_code set default public.gen_media_short_code();

-- A default alone would leave an explicit `short_code: null` from app code as null; the trigger
-- makes the column unconditional whatever the caller passes.
create or replace function public.set_media_short_code() returns trigger
  language plpgsql as $$
begin
  if NEW.short_code is null then
    NEW.short_code := public.gen_media_short_code();
  end if;
  return NEW;
end; $$;

drop trigger if exists brand_media_short_code_trg on public.brand_media;
create trigger brand_media_short_code_trg
  before insert on public.brand_media
  for each row execute function public.set_media_short_code();
