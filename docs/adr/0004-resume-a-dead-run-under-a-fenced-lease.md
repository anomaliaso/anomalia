# Resume a dead run under a fenced lease

Supersedes [0002](0002-defer-distributed-run-leases.md), which deferred leases until
independent workers had to resume the same run. That condition now holds. The gate was
never a second machine: a turn already runs in two places — the request that streams it
(`chat/+server.ts`) and the queue drain (`queue.ts`) — and the durable thread event log
([0003](0003-durable-thread-event-log.md)) means the browser no longer has to be the one
receiving a turn for that turn to be visible. A run that outlives its invocation is the
ordinary case, not a distributed-systems hypothetical.

Decision: a run is held by a lease — an owner, a monotonic fence, an expiry — and a run
whose lease has expired is taken over by the next invocation instead of being killed.
Claiming is one statement that accepts a run that is open (`queued`, `waiting_input`,
`waiting_takeover`) or `running` with an expired lease, and increments the fence and the
attempt count in the same write. Every write that can corrupt the turn — closing the run
with its message, renewing the lease, refreshing the heartbeat from the stream mirror — is
guarded by `(owner, fence)`, so a worker that lost the run writes nothing.

The guard is the fence, not the abort. A process killed by the platform never receives a
signal; aborting the model call on a failed renewal is a courtesy to a worker that is still
alive and has merely lost the race. Only the guarded `where` clause is load-bearing.

The reaper stops being an executioner. A dead run with attempts left keeps its row
`running` with an expired lease and gets a queued job carrying its id; the drain claims it
with the next fence and continues the same turn. Its partial is not promoted to a message
on that path — the resumed run will produce the final one, and promoting it would leave
half an answer beside the whole one. Only on giving up, after `MAX_RUN_ATTEMPTS`, is the
run aborted and its partial salvaged, which is what the reaper always did.

The effect ledger is reconciled before either branch. It, not the lease, is what stops a
resumed run from repeating a side effect that the dead segment had already started.

What does not port from the benchmark: leader election by advisory lock, which assumes a
connection outliving many poll cycles — a cron invocation is already the single leader, so
the election is unnecessary rather than unimplementable. And unbounded renewal: a run
longer than one invocation's maximum duration must be sliced and reclaimed, not kept alive.
The lease TTL is therefore sized to how long an invocation may legitimately be in flight,
never to how long the work takes.

Rollout is ordered, because deploys here do not run migrations. The lease arguments of
`agent_kit_close_run` default to null and the fence is enforced only when supplied, so the
window between applying the migration and deploying the code that passes a lease keeps
working. Making them required is a later migration, after the deploy.
