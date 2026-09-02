# The kit owns the tools

## What moved

38 files, from `src/lib/server/chat/` to `src/lib/agent/tools/`: the `tools/` directory, the
`createChatTools` aggregator (now `tools/index.ts`), every `*-tools.ts` file, and their tests.
Nothing else changed — no tool gained or lost a parameter, no behaviour differs.

## Why the name was the smaller half of the problem

The kit was described as having replaced the chat. It has not: every kit plugin calls
`createChatTools()` and delegates through `execChatTool`, 18 call sites. `server/chat/` was not the
old system — it was where the tool implementations lived, and the kit was a naming layer on top.

That inversion is what produced the visible symptom. A tool the kit wanted had to be wrapped and
renamed (`content_generate_image` → `generate_image`), so the same capability had two names
depending on which surface you asked, and a tool nobody had wrapped simply did not exist for
agents. 132 tools defined, 23 wrapped.

Moving the definitions under the kit does not close that gap by itself, but it removes the reason
it existed: the tools are the kit's now, so a plugin mounts one instead of renaming one.

## What this deliberately did NOT do

- **No tool was renamed.** A rename and a move in one commit make it impossible to tell which
  broke what, and here a broken tool is a paid turn that fails at the provider.
- **The trade prefixes stay** (`content_*`, `ugc_*`, `web_*`). They say who a tool belongs to,
  which is still useful; what does not belong to a trade already carries the plain name
  (`search_knowledge`, `message_agent`, and now `refine_video` / `motion_control_video`).
- **`server/chat/` was not deleted.** What is left there is runtime and shared infrastructure —
  persistence, threads, queue, room, goal, compaction. The moved tools still import it, and
  deleting it now would delete the kit's own engine.

## What the move actually cost, and the four traps

A move like this is only mechanical until the things that are not imports:

1. **Relative imports in the moved files.** `./shared` survived (it moved too), `./room` did not
   (it stayed) — resolved per file against what actually exists at the destination.
2. **Relative imports in the files that stayed** and pointed at what moved.
3. **`vi.mock('./x')` in tests.** Mocks are resolved specifiers, not module identities: a mock
   pointing at a path that no longer resolves silently stops applying and the real module loads.
   That is how `agent-dm-tools.test.ts` failed with `supabase.from(...).eq(...).eq is not a
   function` — a fake that had never needed to be complete, suddenly asked to be.
4. **Tests that read source files as text**, both as `readFileSync('src/lib/...')` literals and as
   `new URL('./x.ts', import.meta.url)` — the second kind moves with the test and breaks silently.

The first typecheck after the move came back clean and meant nothing: the worktree had no
`.svelte-kit/tsconfig.json`, so `tsc` bailed before reading a single file of ours. `npx svelte-kit
sync` first, then compare the error count to the branch you came from — 336 both sides here.

## Next

Phase B deletes the classic turn path in `chat/+server.ts` and `queue.ts` — the branch taken when
`shouldUseKit` returns null, which happens when `AGENT_KIT` is off *or* the thread has no
`agentId`. That one is not a refactor: it changes what answers a real user.
