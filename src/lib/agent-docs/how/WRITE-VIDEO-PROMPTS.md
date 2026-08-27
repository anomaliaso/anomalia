# How to write a video prompt

For `content` and `ugc`. Read this before writing the prompt of a generated video —
the kind a diffusion model renders, not the kind we build in Remotion code.

Source: Higgsfield's Seedance 2.5 prompting guide
(<https://higgsfield.ai/blog/seedance-2-5-prompting-guide>), condensed. **The full example
prompts are not reproduced here**: the originals run 2,000–5,000 words each and the page
did not return them verbatim. What survives is the part that transfers — the shape, the
ordering, and the locks. If you need a full worked example, fetch the page.

The guide's own framing is worth keeping in mind: most prompts for these models get run
once, so nobody ever learns whether they hold up a second time. Everything below is what
the author kept after running each one repeatedly.

---

## The model this was written for

| | |
|---|---|
| Resolution | up to 1080p |
| Clip length | up to 30s |
| Aspect | 9:16 through 21:9 |
| Audio | ambience, foley and score in the same pass |
| Consistency | identity, wardrobe and lighting across shots |
| References | up to 50 multimodal reference images; region editing without a full re-render |

The section structure below is not Seedance-specific. It is how you describe a shot to
any video model that accepts long prompts.

---

## The ten sections, in order

Write them as continuous prose under labelled headings. **Skipping a section does not
leave a gap — it produces a specific, predictable failure**, named after each one.

1. **GLOBAL STYLE** — genre, colour grade, film stock, aspect ratio, shutter behaviour,
   and what must never appear. *Skip it and every cut is graded differently.*
2. **SCENE** — one-line logline: action, location, mood.
3. **CHARACTERS** — face, hair, build, wardrobe, for every person. *Skip it and faces
   drift between cuts.*
4. **LOCATION** — the space and its props, described **separately from the characters**.
   *A vague location is the most common cause of drift across a sequence.*
5. **FIRST FRAME AND BLOCKING** — exact starting positions and directions, before anything
   moves. *Skip it and the model invents the opening, which is the frame that decides
   whether anyone keeps watching.*
6. **SHOT BY SHOT** — "Shot 1", "Shot 2", each with its type and its action. **Pacing is
   built here, with hard cuts** — not by asking for "fast pacing".
7. **OPTICS** — lens and camera movement, per shot.
8. **PHYSICS** — how fabric, smoke, hair, liquid and debris move.
9. **LIGHTING** — what motivates the light, from where, and how it hits surfaces.
10. **AUDIO** — ambience, effects, and what must not be heard.

> One visual rule at the top, one sound rule at the bottom, everything in between broken
> into shots.

---

## What actually separates a good prompt from a lucky one

**Lock numbers, not adjectives.** Focal length in degrees or millimetres, shot duration in
seconds, cut timings, light angles, particle counts, speeds. "Cinematic" is not a lock;
`47°` and `29°` are. In the drama example the lens is locked wide for the establishing
shots and long for the two portraits, and that alone produces the depth separation without
a word about depth of field.

**Write positive locks, not just exclusions.** A rule phrased as a mechanism the model can
execute beats a prohibition it has to remember. "Individual bills tumble and flutter
independently" prevents a rigid block of money better than "not a solid mass". "Colour
waves spread from footfalls at constant speed" gives one repeatable mechanic instead of a
description to re-improvise every cut.

**Exclusions matter as much as inclusions**, and the good ones are specific: no readable
text except one word; no national flags on the suits; no neon anywhere; no blood — bodies
crumble to ash after a glowing cut.

**Give continuity a direction.** Screen geography ("she always travels right to left")
holds a sequence together across cuts far more cheaply than describing the street again
each time.

**Let state accumulate and never reset.** Soot and scorch marks that build up; a product
that goes whole → bitten → two halves → finished and never regrows. Progressive state is
what makes a sequence read as one event instead of a set of clips.

**Treat physics, lighting and audio as three separate systems**, each specified on its own.
They are not adjectives on the scene.

---

## The genre notes that matter for us

**UGC — the one to read twice.** Authenticity comes from *not* looking produced. Fixed
selfie framing held for the whole clip; handheld wobble with small refocus moments;
turbulence or disturbance early, then the frame settles. Understated acting: natural blink
rate, reactions half a beat late, small growing smiles, a glance away from the lens
mid-sentence. Background people behave independently — nobody looks at camera, nobody
reacts in sync. And explicitly: **no on-screen text, no captions, no packshot ending, no
music** — only real ambience, decaying as the scene calms.

That last rule is not a stylistic preference for us: it is the same finding our own data
gave us. **A diffusion model cannot be trusted to draw letters.** Asking one for an
on-image headline is how we get "Social growts" and "Scopa menu" burned into a frame. If
type is needed, it is drawn in code over the generated footage, never asked for inside the
prompt.

**Commercial product.** Lock the references — person, location, product — so a stylised
effect can happen *around* them without any of the three being redesigned. Keep signage
unreadable and everything unbranded unless the brand is ours and drawn by us.

**Action and fast cutting.** Pace comes from shot count and hard cuts, not from asking for
speed. One warm accent inside a cold grade directs the eye across every cut without
re-describing attention in each one.

---

## Before you send it

- Every section present, in order.
- At least one locked number per shot.
- Character description that would let a stranger recognise the person.
- One mechanic for any repeated visual effect, phrased as a rule the model can run.
- The audio section says what is *not* heard.
- **No request for readable text anywhere in the frame.**
