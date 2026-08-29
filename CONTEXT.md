# Anomalia

Anomalia is a social media AI autopilot: a team of specialist agents produces, publishes and improves content for a brand. This glossary fixes the language of that team.

## Language

### The team

**Main agent**:
A persistent specialist of the default team (Analyst, Content Creator, UGC Specialist, Motion Specialist, Web Specialist) or a custom agent hired by the brand. Lives in its own threads, keeps its identity and journal across turns.
_Avoid_: worker, instance, sub-agent.

**Subagent**:
A short-lived in-turn helper spawned by one main agent to split its own macro-task. Shares the delegating agent's goal and voice context; has no identity and no thread of its own.
_Avoid_: colleague, teammate.

**Generalist (Anomalia)**:
The agent with no craft (agent = null). Routes and covers when no specialist fits; cannot open a user session of its own.
_Avoid_: omni, assistant.

**Custom agent**:
A brand-hired agent built on a specialist's craft, with its own name, face and routines. Gets a team thread of its own from the moment it is hired.
_Avoid_: scheduled agent, routine.

**Agent Kit**:
The one environment every main agent runs its turns in: a persistent session with its own tools, skills and memory, kept across all its threads. There is no second way to run a turn.
_Avoid_: harness, bridge, kit mode, engine.

### Threads

**Team thread**:
One persistent thread per main agent where it works with the user (`surface='team'`). Doubles as the agent's work journal: every routine run leaves its report there.
_Avoid_: agent chat, journal (journal is the role, not the object).

**DM (agent-to-agent)**:
The private thread between exactly two main agents. Coordination only: the work that concerns the user happens in a team thread.
_Avoid_: private chat, room.

**Private thread**:
A thread where the user talks with exactly one main agent, away from the team.
_Avoid_: DM, direct message, one-to-one chat.

**Room (group chat)**:
A thread where several agents and the user talk in turns. Behind a flag; not the default surface.

**Onboarding thread**:
The setup thread (`surface='onboarding'`), one per brand, held by the Analyst. The only thread seeded when the brand is created.

### Collaboration

**Delegation**:
One main agent handing a job that belongs to another agent's craft to that agent — by DM message, never by doing the work itself with borrowed tools.
_Avoid_: assignment, forwarding.

**User session**:
A team thread opened by an agent that has work needing the person: it writes its opening line there and keeps working in it.
_Avoid_: open thread, handoff.

**First contact**:
A specialist's opening move toward a brand-new user: it declares the agent's craft and performs one concrete first action — never a greeting.
_Avoid_: welcome message, intro.

**Team contact (onboarding)**:
The server-guaranteed first contact of the specialists mapped to the brand's plan, delivered after the Analyst's setup turn. A product promise, not a model behaviour.
_Avoid_: fan-out, broadcast.

**Brand memory**:
The shared memory of a brand: facts, skills and notes any main agent can read and write. The place a notion lives when it must outlive the turn that produced it.
_Avoid_: context, knowledge base.
