# Durable, sequenced thread event log

Context: Anomalia currently renders a thread from `chat_messages`, resumes
classic turns from `chat_jobs.partial`, resumes Agent Kit turns from
`agent_kit_runs.partial`, and joins Kit streams through Realtime chunks with
`ChunkPosition`. These paths have different cursors and recovery rules.

Decision: introduce one append-only event log per thread. Every event receives
a monotonic, gap-free `seq` inside the same transaction that changes the
thread state. The client and server use one ordered reducer for refresh, live
join, and resume. Realtime publishes only the thread id and latest sequence;
the event query is authoritative.

Progress is represented by durable absolute snapshots keyed by `runId`, not by
text or reasoning offsets. A progress snapshot is a projection input, not a
message. A terminal event and the final assistant message are committed
together. `chat_messages` remains a materialized read model during and after
the migration; it is no longer the live/resume source.

Retries use a producer `sourceKey` unique within a thread. A duplicate key
returns the existing event; a conflicting payload fails. The sequence counter
and event insert share the transaction, so rollback consumes no sequence.
Missing notifications, duplicate notifications, process death, and client
reconnects are handled by reading `seq > cursor`.

The event reducer never calls tools or replays external effects. Tool
idempotency, retries, ambiguous outcomes, and reconciliation remain the
responsibility of the `ExternalEffect` ledger from task #99. Events may carry
an effect id and status reference for audit, never executable effect input.

Migration is incremental: define and test the reducer, add the writer and
backfill, dual-write all thread mutations, shadow-compare projections, switch
refresh and live delivery behind a flag, then retire partial mirrors,
position handling, and payload-carrying Realtime events. Existing clients
continue receiving the legacy stream until the new reader is enabled for all
supported clients.

The detailed schema, event catalogue, retention/compaction contract,
backfill procedure, and acceptance tests live in Notion task #100:
https://app.notion.com/p/3cb2944ee2a781f2bf8ff5de271865a8a?pvs=204
