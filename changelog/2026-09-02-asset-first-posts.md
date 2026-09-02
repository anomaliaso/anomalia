# Generating and posting become two steps

## The dead end this closes

`refine_video` and `motion_control_video` shipped yesterday returning a `video_url` and touching no
post. That was the right shape and a dead end: **no tool could attach that URL to a post.**
`create_post` accepts `media_ids` — library assets — and no mp4. So you could refine a clip and
then do nothing with it.

The fix is not a `video_url` parameter on `create_post`. It is that generating and posting were
fused, and every wart we have hit came from that fusion:

- `generate_image` had to grow a `post_id` mode to mean "edit the one on this post"
- `ugc_generate_video` had to force `content_type: 'video'` inside `create_post` because no tool
  made a clip on its own
- and there was no way at all to get an mp4 without creating a post draft first

## The split

**Producing** — `generate_image` (existed), `generate_video` (new), `refine_video` /
`motion_control_video` (yesterday). Each returns an asset and writes no post.

**Publishing** — `create_post_from_asset(type, media_ids, caption)`. Takes what already exists and
writes the row.

`create_post` stays as the one-shot path for when the visual and the post are made in the same
breath. It is not deprecated and not reimplemented here — doing both in one commit would make a
regression impossible to place.

## Everything goes through the library

`generate_video` and the two transform tools deposit their clip in `brand_media` and return a
`media_id`. Not a convenience: a rendered mp4 that is not in the library is **a file we paid for
that no tool can reach**, which is precisely the state `refine_video` shipped in, and precisely
what `applyToPost` already warns about for post-bound renders — "a clip that exists, is paid for,
and is reachable by nothing".

The library is also the only place an asset is reusable by everything else already: `read_media`,
`media_ids`, `create_post_from_asset`. So generated media goes where uploaded media goes, instead
of a second private path that only one tool understands.

The deposit is best-effort. If it fails the clip still exists at its URL and the result says so,
with a hint telling the model to say it rather than promise reusability — failing a paid render
over an INSERT would be worse than losing the id.

## Why the type list is a table, and why it is short

`content_type`, `format` and `media_origin` have to move **together**. An mp4 in `media_url` with
`format: 'image'` is a reel the editor opens as a photo and that breaks at publish, with nothing
logged — and it is reachable today because those three fields are written in three places. One row
per type, in `post-from-asset.ts`, is what keeps them in step.

**`motion` is deliberately not a type.** A Remotion composition renders to an mp4; at posting time
it *is* a video. Two enum values writing the identical row is two names for one thing, and the
difference that matters — how the asset was made — is recorded upstream already.

**`graphic` is deliberately not a type either, and this is the sharp edge.** A typographic graphic
is not a PNG: it is HTML/TSX the post keeps so it can be edited later. `media_origin:
typographic_graphic` exists for exactly that, and `grep_source` / `replace_source` depend on it. A
`create_post_from_asset(type:'graphic')` taking rendered pixels would make every graphic
uneditable — it would look like it worked and quietly destroy the best editing path we have. So
graphics stay on `create_post(graphic_brief)` / `design_graphic`, which carry the source.

## The generalisation, not the copy

`publishLibraryImageAsPostMedia` was hardcoded to `kind: 'image'` with a 12MB ceiling. Rather than
a parallel video twin, it became `publishLibraryMediaAsPostMedia` with `kind` as **the query
filter**: a photo published as a reel — or a clip as a still — is a plausible, wrong post that
neither storage nor the provider would flag, and the row's `kind` is the only thing that knows. An
empty result is a refusal, not a guess. The old name is kept as a thin alias for the six callers
that only ever publish images.

The size ceiling had to become per-kind: 12MB is generous for a still and below a single 15-second
clip, so reusing it would have refused nearly every video with "asset too large" — an error about
size that hides a limit belonging to another job.

## Where the credit gate sits

On `generate_video` the gate runs **in the tool, before the job is queued** — not in the job. A
queued job that discovers exhausted credits minutes later reports it after the turn has closed,
when nobody is watching.

## Not verified

`generate_video` has not been run against kie: it costs a real render. The job path mirrors the
seven cases already in `job-executor.ts` and `renderVideo` is the function the post path uses in
production, but the first live call is still the first live call.
