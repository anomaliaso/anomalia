# Valeria — Talent library (prototype)

FEMALE · 24 · SLIM · Latin American

Valeria is a 24-year-old Latin American woman with a warm, radiant presence —
tall and lean with deep black spiral curls, brown mahogany skin, and a soft
knowing smile that feels effortless rather than posed.

## Structured traits

| Field | Value |
|-------|-------|
| Capelli | deep black mid-back spiral curls · slight off-center part · always fully down framing both sides |
| Occhi | deep brown iris, visible sclera, distinct pupil |
| Viso | lean face, subtle bone structure, moderate cheek definition |
| Pelle | brown with warm mahogany undertone |
| Corpo | slim, lean frame, little body fat |
| Segni | 2–3 faint 1–2mm dark spots left cheek + one near right cheek |
| Wardrobe | heather-gray scoop sports bra (thin parallel straps, straight back band — no racerback) + matching boy-shorts |

## Reference views (this pack)

1. `01-face-front` — Viso frontale · **identity + hair canon**
2. `02-body-front` — Corpo quasi intera frontale · **wardrobe canon**
3. `03-face-three-quarter` — Viso ¾
4. `04-face-profile` — Viso profilo / lato
5. `05-hands-detail` — Mani
6. `06-body-three-quarter` — Corpo quasi intera ¾
7. `07-body-back` — Corpo schiena

Shots 03–07 are conditioned on both face-front and body-front refs so hair + outfit stay locked.

Generate with:

```bash
GEMINI_API_KEY=… node scripts/talent/generate-valeria.mjs
```

Outputs land in `artifacts/talent/valeria/` (gitignored) and
`/opt/cursor/artifacts/talent/valeria/` when run in Cloud Agent.

## Persist to Supabase

Optimize (WebP q82, max edge 1600) + upload to private `talent` bucket +
upsert `talents` / `talent_views`:

```bash
node scripts/talent/save-valeria.mjs
```

Requires `PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
Server helpers: `listTalents` / `getTalent` in `$lib/server/talent`.
