# Agent Kit is the only turn engine

> **Superseded (2026-09-04).** This ADR decided the Agent Kit would absorb every chat surface.
> There are no chat surfaces left: the in-app chat was removed and Anomalia now works through
> external agents over MCP. The Kit bridge (`agent/bridge/live.ts`, `agent/plugins/`) and the
> `AGENT_KIT` flag are deleted; the `chat_jobs` queue survives as background execution for long
> agent work, which is what it always was under a misleading name. Kept for the record.

Context: two turn engines coexist. The Agent Kit bridge (persistent sessions, kit tools, memory)
runs specialist team threads; a classic `chat_jobs`-based runner still executes private threads,
rooms, custom agents and scheduled runs — selected at runtime by the `AGENT_KIT` env flag. Even
with the flag on, most user-visible conversations never touch the Kit.

Decision: the Agent Kit becomes the single engine for every chat surface — agent-to-agent DMs,
rooms, custom agents and scheduled runs included. The classic runner is deleted when the last
surface migrates, and `AGENT_KIT` is removed from code, env examples and docs. Migration is a
strangler, one surface per PR in this order: agent-to-agent DMs, custom agents, scheduled runs,
rooms. Each flip retargets the surface's existing test suite to the Kit as its parity spec
(push notification, speaker signing, room continuation, scheduled briefs — ported faithfully,
simplifications decided only after parity). In-flight `chat_jobs` for a migrating surface drain
on the classic runner before the flip; no data migration.

Considered options: (B) keep both engines forever with explicit per-surface routing and no flag —
rejected: the parity cost (mirroring protections across engines) is paid forever; (C) drop
agent-to-agent DMs/rooms/custom agents as features — rejected: DMs carry agent-to-agent
delegation and custom agents are a product surface. Absorbing them preserves the product promise
that every agent is equally capable in every thread.
