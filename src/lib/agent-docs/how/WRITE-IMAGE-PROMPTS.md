# How to write an image prompt

For whoever hands a prompt to Nano Banana — the image agent's `render_image`, and the
`generate_image` brief that seeds it. Not for video (that is `how/WRITE-VIDEO-PROMPTS.md`)
and not for typographic graphics, which are drawn in HTML/TSX and never diffused.

Source: the Nano Banana prompting guide from `NikiforovAll/claude-code-rules`
(Apache-2.0), condensed. Four of its sixteen techniques are **deliberately not here** —
they teach things that are defects in this pipeline. The last section says which, and why.

---

## The shape

**Default to narrative.** One paragraph of prose: subject, what it is doing, where, then a
closing line that anchors the aesthetic. The model reads intent, not tag soup — a comma
list of adjectives is the single most common way to get a generic render.

> A young woman stands almost sideways, slightly bent forward, during the final preparation
> for the show. Makeup artists apply lipstick to her. The main emphasis is on her face and
> the details of her costume.

**Switch to structured (YAML) only when precision is the point** — a product whose finish
must survive, a scene with several distinct subjects that keep bleeding into each other.
Structure buys control at the cost of life; a structured prompt for a candid photo reads
like a spec sheet and renders like one.

```yaml
subject:
  girl: { hair: "long, wavy brown", expression: "puckering toward the camera" }
  puppy: { type: "small white puppy", eyes: "light blue" }
photography:
  camera_style: "early-2000s digital camera aesthetic"
  lighting: "harsh super-flash, blown-out highlights, subject still visible"
```

---

## What separates a good prompt from a lucky one

**Photography terminology, not adjectives.** This is the largest single win, and it is the
antidote to the QC failure we hit most (*"technically correct but generic"*). Name the
gear, the light and the texture and the render stops looking like an AI render:

- *Gear* — "shot on a Sony A7III with an 85mm f/1.4 lens, flattering portrait compression".
- *Light, by name* — "classic three-point setup, key light casting soft defining shadows,
  a subtle rim light separating the shoulders from the dark background". Or by clock:
  golden hour, blue hour, harsh noon, overcast diffusion, night on artificial light.
- *Texture, asked for explicitly* — "natural skin texture with visible pores", "subtle wool
  in the suit". Waxy skin is what you get when nobody asks.
- *Focus and grade* — "exquisite focus on the eyes"; "clean, bright cinematic grade with
  subtle warmth".

**A vibe is a list of signature details, not a mood word.** "2000s bedroom" renders as
nothing; *CD player, beaded door curtain, cluttered vanity of lip glosses, pop-icon posters*
renders as 2003. Same for film noir (venetian-blind shadows, smoke, rain on the window),
Wes Anderson (symmetry, pastels, centred framing), Blade Runner (neon rain, steam, cramped
frames). Find the props that only that era owns, and name them.

**Candid beats posed.** "Looking slightly away from the camera, holding a coffee cup,
relaxed" outperforms any amount of "authentic, natural, genuine".

**Give every reference a job.** When more than one image is attached, say what each is for
— upstream calls it role assignment and it is the difference between a composite and a
mush: *"pose from image 1, colour palette from image 2, the environment from image 3."*
The usual roles are subject, style, palette, environment, branding.

**To edit, use task verbs.** Editing an attached base frame is a list of operations, not a
new description: *"identify the main product, cleanly extract it, recreate it as a premium
e-commerce shot on pure white, removing any fingers, hands or clutter."* Say what leaves
the frame as explicitly as what stays.

**Exclusions are cheap and specific.** "no date stamp", "not rustic", "no neon". Reach for
them when a render keeps volunteering the same unwanted thing — a negative is how you stop
a repeat, not how you set a style.

**Ask for a viewpoint when the subject is a concept.** "How engineers see the Bay Bridge"
gets you blueprints, stress lines and structure without you having to invent the shot.

---

## The four rules this pipeline adds

Upstream is written for one person generating one image. These four are ours, and each one
is a defect we have already paid for.

1. **Never ask for readable text.** No headline, no label, no caption, no number, no
   barcode, no arrow diagram — a diffusion model cannot be trusted to draw letters, and it
   returns "Social growts" and "Scopa menu" burned into the frame. Type is drawn in code
   over the image (`design_graphic`, the typographic graphic path), never asked for inside
   the prompt. This kills upstream's magazine covers, its infographics and its in-image
   translation outright.
2. **Never state an aspect ratio, a resolution or a crop.** `aspectRatioFor(platform)`
   decides the canvas and `render_image` carries it as its own `aspect` argument. A prompt
   that says "9:16 vertical poster" fights the renderer and loses — or worse, wins, and
   draws a poster inside the photo.
3. **Never describe the appearance of a named person.** No gender, age, body, face, hair,
   skin or ethnicity. Identity is locked from the attached reference photos; a description
   competes with them and the render drifts off the real person. Describe only pose energy,
   expression, wardrobe, lighting, camera and environment.
4. **Match the brand's medium.** If the brand's visual style is illustrated, editorial or
   collage, the prompt describes an image *in that medium* — never a photograph, and never
   "a photo for variety". Photorealism is the default only when the brand's style is
   photographic or when there is no style at all.

And one that is not a rule but a habit: the brand's official logo is attached on every
render when it exists. Reproduce **that** mark when branding appears; never invent one, and
on a candid photo with no branding leave it out.

---

## Before you send it

- Subject, action and setting present, in prose.
- At least one photographic specific: lens, named light, or texture.
- Era or style carried by props, not by an adjective.
- A job assigned to every attached reference.
- No readable text requested anywhere.
- No aspect ratio, no resolution, no crop.
- No physical description of a named person.
- The medium matches the brand's visual style.
