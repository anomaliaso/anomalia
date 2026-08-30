# The browser follows the log, and the request stops streaming the turn

Context: a turn is executed by the request that asks for it, and the answer is streamed back
over that same connection. Everything that makes a reload survivable was built to compensate
for that: a chunk broadcast carrying text offsets, a client that matches those offsets against
its own and queues what does not fit, two mutable `partial` mirrors, a four-second poll, and an
orphan-run reattach. Five mechanisms, all of them existing because the truth lived in a
connection instead of in the database.

[0003](0003-durable-thread-event-log.md) put the truth in the database, and
[0004](0004-resume-a-dead-run-under-a-fenced-lease.md) made a run outlive the invocation that
started it. Neither removed the streaming path, so the product now carries both.

Decision: the request stops executing the turn. It saves the user's message, queues the turn,
wakes the drain and returns. The turn is executed away from the request, and the browser renders
by following the durable event log — the same log, through the same reducer, on a cold load and
on a live tail. A tab opened halfway through a turn shows what a tab that never left is showing,
because both are folding the same rows.

The trade is explicit and was chosen: text appears in 250ms snapshots instead of token by token.
Four updates a second is below the threshold where a reader perceives a step, and it buys the
property that the streaming design could only imitate — nothing is lost, ever, because nothing
is ever only in flight.

What this deletes, and deletion is the point: the payload-carrying broadcast and its offsets,
the offset-matching client and its pending queue, both `partial` mirrors, the four-second poll,
and the orphan-run reattach. The benchmark's entire application weighs what this repository's
chat directory weighs; the distance is closed by removing, not by adding.

Migration is staged, in the order [0003](0003-durable-thread-event-log.md) already prescribes.
First the log is made sufficient: the cold load projects progress, so a reload paints the
half-written answer at first render — until that holds, the log cannot drive the UI alone and no
switch may be thrown. Then the request stops streaming and the drain executes. Only then are the
compensating mechanisms removed, one at a time, each with the scenario that would have caught its
loss.

The risk is concentrated in one place and named here: this is the product's hot path, and a
regression is a chat that does not answer. The durability scenarios
(`npm run eval:durability`) are the gate; the browser engine that would cover a mid-stream reload
does not exist yet, and building it belongs to the stage that throws the switch, not after it.
