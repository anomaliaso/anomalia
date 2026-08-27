-- Editable HTML / TSX source for typographic graphics (alongside the legacy block JSON spec).
-- New versions write source + spec { v: 2, kind, aspect }. Old rows keep spec-only; the app
-- projects HTML from the block JSON on read until they are re-saved.

alter table public.graphic_designs
  add column if not exists source text;
