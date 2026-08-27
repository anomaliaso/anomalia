-- 0099 talent categories: sex taxonomy + physical filter columns.
-- Sex: man | woman | trans_man | trans_woman | nonbinary
-- Physique filters: body_type, height_band (filterable in pickers).

-- Normalize legacy gender values before constraining.
update public.talents set gender = 'woman' where gender in ('female', 'donna');
update public.talents set gender = 'man' where gender in ('male', 'uomo');

alter table public.talents rename column body to body_type;

update public.talents set body_type = 'athletic_slim' where body_type = 'athletic-slim';

alter table public.talents
  add column if not exists height_band text;

alter table public.talents
  drop constraint if exists talents_gender_check;

alter table public.talents
  add constraint talents_gender_check
  check (
    gender is null
    or gender in ('man', 'woman', 'trans_man', 'trans_woman', 'nonbinary')
  );

alter table public.talents
  drop constraint if exists talents_body_type_check;

alter table public.talents
  add constraint talents_body_type_check
  check (
    body_type is null
    or body_type in ('slim', 'athletic', 'athletic_slim', 'average', 'curvy', 'plus', 'muscular')
  );

alter table public.talents
  drop constraint if exists talents_height_band_check;

alter table public.talents
  add constraint talents_height_band_check
  check (
    height_band is null
    or height_band in ('short', 'average', 'tall')
  );

-- Sensible defaults for the first pack (can be refined later).
update public.talents set height_band = 'tall' where slug = 'valeria' and height_band is null;
update public.talents set height_band = 'average' where slug in ('noah', 'amara', 'priya') and height_band is null;

create index if not exists talents_gender_idx on public.talents (gender);
create index if not exists talents_body_type_idx on public.talents (body_type);
create index if not exists talents_height_band_idx on public.talents (height_band);
create index if not exists talents_ethnicity_idx on public.talents (ethnicity);
