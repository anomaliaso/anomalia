# A model per job, and the two jobs that were missing

## What was there before

One `imageModel` and one `videoModel` on `content_prefs`, both added days earlier by
`feat/media-model-picker`. They read as two settings; they were doing six jobs' work.

`imageModel` covered both drawing a photo from a prompt and editing one that already exists.
`videoModel` covered generating a clip from text, animating a rendered cover, and — nominally —
refining a clip and motion control, neither of which existed anywhere in the codebase. The video
catalogue was Grok Imagine plus four Seedance rows. No Kling at all.

## Why it had to become a registry first

`videoModelCaps` decided a model's duration window, prompt ceiling and aspect ratios through a
chain of regex `if`s whose **order was the rule**: `seedance-2-5` had to be tested before
`seedance-2`, which prefixes it, or a 30-second model silently inherited a 15-second ceiling.
Nothing declared that except a comment. Adding Kling would have been a fourth branch appended
wherever it happened to land, and adding roles on top of it would have multiplied the branches by
four.

So the same shape `image-models.ts` already uses: one row per model, precedence visible as row
order. That commit changes no behaviour — the rows carry exactly what the branches returned — and
it is separate on purpose, so that if something moves in the duration windows the diff that did it
is one commit and not tangled with the feature.

## The four roles

`text`, `image`, `refine`, `motion`. They are not tiers of one scale, which is the whole reason
they are a list per row instead of a level:

- **text** — from nothing, words only.
- **image** — animates a still that already exists (usually the cover the image pipeline rendered,
  which carries all the grounding — real product, person identity, palette, QC — for free).
- **refine** — rewrites a finished clip, keeping the motion, changing what is seen.
- **motion** — takes the movement from a driving video and applies it to a subject in an image.

Grok and Seedance have **no video input at all**. For them `refine` and `motion` are not a worse
tier; they do not exist, and the picker for those jobs must not offer them. Kling 3.0 joins for
generation and motion control, Kling V3 Turbo for image-to-video only (without an image it has
nothing to animate, so it is absent from the text picker), Runway Aleph for refine.

**Explicitly not in this table:** the programmatic motion video (Remotion, `motion_write`). That is
TSX rendered in a VM, not a generative model. Conflating the two is exactly the confusion the word
"motion" invites, and the reason the tool descriptions say so twice.

## Why `endpoint` is in the table

Runway Aleph lives off the jobs API: `POST /aleph/generate` to submit, `GET
/runway/record-detail?taskId=` to poll, state at `data.state`, URL at `data.videoInfo.videoUrl`,
and every field in camelCase. Sending it `video_urls` is an HTTP 200 carrying a refusal — a paid
round trip that returns nothing and looks like a hang.

Rather than an `if (model.startsWith('runway'))` somewhere in the submit path, the row declares
where it lives, and `transformVideo` reads it. Two providers, one branch, in the place that already
knows every other difference between them.

## The rule that made the slot list worth writing

Six near-identical forms would have been six copies of the same validation. The rule that would
have diverged first is the one that matters most: **a model is only savable in a slot whose job it
actually does**. Without it the form accepts a model the renderer later drops, and the preference
exists while doing nothing — the quietest possible way to not work. A stored slot that stops
passing that check reads back as "Platform default" rather than as a choice already made.

## Backward compatibility, deliberately

- `imageRefineModel` empty → the generation model.
- `videoImageModel` empty → the clip model.

Both because every brand that predates the split had one setting covering both directions, and
reading only the new key would have silently stripped a choice they already made. A brand that
never opens the new slots renders exactly as it did.

## What `buildImageRequest` knows that nobody else does

`baseImage` is the single signal that separates an edit from a fresh drawing, and **every** image
render routes through `buildImageRequest`. So the refine model is chosen there rather than at each
call site, and a path nobody remembered to update gets it too.

Reference and mood images deliberately do **not** trigger it. Those are things to reproduce, not a
base to edit; treating them as edits would have retired the brand's generation choice on roughly
half its posts without anyone touching a setting.

## A defect found on the way

`src/lib/server/media-generator/agent.ts` read `prefs` from inside a `try` block that had already
closed, so `model: imageModelFor(prefs)` did not compile and the media generator **never applied
the brand's image model at all**. It shipped in `feat/media-model-picker` and `tsc` has been
flagging it on `dev` since. One declaration hoisted to the scope both readers can see.

## Rejected

- **A `videoRefine` boolean on the existing rows.** Would have answered "can this model refine?"
  and nothing else — not which kie id to send, not which field carries the video, not which
  endpoint. Four roles with per-role kie ids answer all of them from one row.
- **Replacing a post's clip directly from `refine_video`.** Both new tools return a URL and touch
  no post. Overwriting an approved clip is a change nobody asked for, on something the user has
  already watched and accepted.
- **Guessing the Kling O3 video-edit model id.** kie's marketing pages document Kling O3 as doing
  video-to-video edits, but the docs page for it 404s and the exact id and field names are not
  published. Refine ships on Runway Aleph, whose contract is fully documented and was read in full.
  Adding Kling O3 later is one row.

## Not verified

Neither new tool has been run against kie: both cost a real render. `buildTransformInput` is tested
against the documented payloads, and the submit/poll paths mirror the ones `renderVideo` already
uses in production, but the first live call is still the first live call.
