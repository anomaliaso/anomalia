# The agents can finally see the Media library

## The rule nobody could follow

`content_create_post`'s own description says it, in capitals:

> MEDIA FIRST: pass media_ids to reuse a library asset instead of minting a new AI image (free)

No kit trade could list the library. The agent had somewhere to *put* an id and nowhere to *get*
one, so "reuse before you generate" was unfollowable and every visual was minted from scratch —
billed, on a brand that already owned a photo that fit.

That is the whole defect. The input existed, the discovery did not.

## What was mounted, and what was not

`read_media` and `use_library_image`, on the trades that already accept `media_ids` — content and
ugc — from the same one declaration the video tools use.

**Not the other 25 unmounted read tools.** They looked like the same gap and mostly are not: the
kit reads a brand as a *file tree*, not through `read_*` calls. `brand_read` opens
`brand/studio.md` and `brand/strategy.md`, `brand_grep` finds across them, and `query` reads the
database with the user's own permissions. The specs already tell every agent to do exactly that,
and mounting 25 more tools would have paid tokens on every turn to duplicate a path that works.

The library is the exception because it is not readable that way. `query` can see the
`brand_media` rows, but the storage bucket is private: an id becomes usable only through a signed
URL, which is what `use_library_image` mints. Listing without signing is half a capability.

## Why this is not the parity work

There are 132 tools in chat and a trade mounts around 30. This closes one gap — the one where a
tool's own description promised something the agent could not do — and leaves the rest measured
but untouched. Closing the whole distance is not a mounting exercise: it needs a decision about
whether the trade scoping survives at all, and that decision is the same one blocking the removal
of the classic turn path.

## Still blocked, and why the classic path stays

Deleting the classic turn path was the next step and is deliberately not taken. `shouldUseKit`
returns null when `AGENT_KIT` is off *or* the thread has no `agentId`, and the kit has five
specialists: analyst, content, motion, ugc, web. There is no spec for the orchestrator — the
project manager that answers when no specialist is picked — and none for `media`. On the local
database that is 29 of 135 threads.

Adding an orchestrator spec is the obvious unblock and is *still not enough on its own*: in the
classic engine that agent reaches 132 tools, and as a kit spec it would reach about 30. Moving it
today would be a downgrade wearing the clothes of a cleanup. Tool parity comes first; this is its
first instalment.
