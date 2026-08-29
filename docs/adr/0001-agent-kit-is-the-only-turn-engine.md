# Agent Kit is the only turn engine

Context: two turn engines coexist. The Agent Kit bridge (persistent sessions, kit tools, memory)
runs specialist team threads; a classic `chat_jobs`-based runner still executes private threads,
rooms, custom agents and scheduled runs — selected at runtime by the `AGENT_KIT` env flag. Even
with the flag on, most user-visible conversations never touch the Kit.

Decision: the Agent Kit becomes the single engine for every chat surface — private threads,
rooms, custom agents and scheduled runs included. The classic runner is deleted when the last
surface migrates, and `AGENT_KIT` is removed from code, env examples and docs. Migration is a
strangler, one surface per PR in this order: private threads, custom agents, scheduled runs,
rooms. Each flip retargets the surface's existing test suite to the Kit as its parity spec
(push notification, speaker signing, room continuation, scheduled briefs — ported faithfully,
simplifications decided only after parity). In-flight `chat_jobs` for a migrating surface drain
on the classic runner before the flip; no data migration.

Considered options: (B) keep both engines forever with explicit per-surface routing and no flag —
rejected: the parity cost (mirroring protections across engines) is paid forever; (C) drop
private threads/rooms/custom agents as features — rejected: private threads carry agent-to-agent
delegation and custom agents are a product surface. Absorbing them preserves the product promise
that every agent is equally capable in every thread.
