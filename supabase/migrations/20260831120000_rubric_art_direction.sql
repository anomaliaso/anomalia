-- La direzione artistica della serie: due rubriche dello stesso brand possono avere due registri
-- visivi diversi (un reportage fotografico e un fumetto illustrato). Null → la serie eredita il
-- visual_style del brand, che è il comportamento di prima.
alter table public.rubrics add column if not exists art_direction text;
