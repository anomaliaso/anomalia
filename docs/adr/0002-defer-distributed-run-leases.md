> Superseded by [0004](0004-resume-a-dead-run-under-a-fenced-lease.md).

# Defer distributed run leases until worker takeover is required

Keep the current persisted run state and state CAS while an Agent Kit turn is
executed by one invocation. Defer `leaseOwner`, monotonic `fence`, computer
execution leases, and per-acquisition `Attempt` until independent workers can
resume the same run; introducing them now would change the state machine,
reaper, computer lifecycle, every run write, and their tests without a current
product requirement.

This is a hard gate for multi-worker execution. At that point, run claims,
heartbeats, reclamation, finalization, and side effects must all be guarded by
the current `(runId, owner, fence)` generation, and a failed renewal must abort
the active model call.
