# Workshop Prompts

Seven prompts that carry one branch from the bare `create-mastra` scaffold to the full Dev Daily
Assistant. You paste each one into your agentic IDE, read what it does, and end the session with a
codebase you drove there yourself.

The spec these prompts implement is `AGENT_CHECKPOINTS.md`. Read a checkpoint's section there if you
want to know *why* a step exists before you run it.

---

## How the session works

**You work on one branch, start to finish.**

```bash
git fetch --all
git checkout -b my-build origin/boilerplate
```

That is the only branch you commit to. Commit after each prompt so you can walk back one step
without losing everything:

```bash
git add -A && git commit -m "checkpoint 3: deterministic pipeline"
```

**The `checkpoint-*` branches are a rescue rail, not the route.** They exist so that when your agent
goes sideways — wrong API, half-finished refactor, a state you cannot debug in the four minutes
before the next prompt — you can rejoin the room instead of falling behind:

```bash
git checkout checkpoint-4 -- backend/    # take that checkpoint's code wholesale
cd backend && npm install                # the lockfile differs per branch
git commit -am "reset to checkpoint-4"
```

You do not need to match a checkpoint branch line for line. **Functional equivalence is the bar:**
same files, same exports, same behaviour, acceptance check passes. Your comments and internal wording
will differ from the branch and from your neighbour's, and that is fine.

**Each prompt is self-contained.** Paste the whole fenced block. Do not summarise it or split it up —
the constraints in it are the parts that took someone a debugging session to learn.

---

## Prompt 0 — Setup (before anything else)

Nothing below works until these four are true. Do them by hand; do not delegate them.

**1. Environment file.**

```bash
cd backend
cp .env.example .env
```

Fill in `LITELLM_BASE_URL` and `LITELLM_API_KEY` with the real values the facilitator gives you.
Placeholders fail on the first model call.

**2. The MCP data server must be running and stay running.**

```bash
cd ../agent-sdk-bakeoff-mcp-server
docker compose up --build
```

Leave it up for the whole session. From prompt 1 onward, the app fetches the MCP tool list **at module
load time**, so an unreachable server is a startup crash, not a runtime error. If your app dies
instantly on boot, check this first, every time.

**3. Verify model access.** One real completion, before the room moves on. If your key is wrong you
want to know now, not at prompt 5.

**4. Postgres is *not* needed yet.** It arrives at prompt 2, along with the `docker-compose.yml` that
starts it. Do not set it up early.

---

## Prompt 1 — The agent primitive

> **Concept:** an LLM loop with tools, nothing else. **Target:** `checkpoint-1`

```text
Read backend/.agents/skills/mastra/SKILL.md first and follow it. Do not rely on cached
knowledge of the Mastra API — it changes between versions, and this repo pins a specific one.

Goal: turn this scaffold into a single agent that answers questions by calling real tools
over MCP. Nothing else — no memory, no pipeline, no review. This is the floor everything
later builds on, and I want to see the floor on its own.

Work in backend/.

1. Add an MCP client in src/mastra/mcp.ts that connects to one server, reachable at
   PULSE_MCP_URL (default http://localhost:8081/sse), and exports the tool list it
   advertises. Forward the server's own instructions to the model rather than restating
   them — the server knows how it resolves relative dates. Note that the tools come back
   namespaced by the key you register the server under; do not strip that.

2. Add src/mastra/config.ts holding the model setup. Models are reached through a LiteLLM
   proxy, which is OpenAI-compatible: one base URL from LITELLM_BASE_URL, one key from
   LITELLM_API_KEY, and bare model names with no provider prefix. Export the agent's model
   as a single named constant — later in this workshop swapping model families has to be a
   one-line change here, so build for that now.

3. Add src/mastra/agents/chat-agent.ts: one agent, id 'chat-agent', with every MCP tool
   attached. Its instructions must state that the tools are backed by real accounts for one
   developer, not a mock dataset, and must impose three rules:
     - answer only from tool output; never state a fact that did not come from a tool call
     - at most 1-3 tool calls per question; if it cannot answer confidently in that budget,
       say what it found and stop rather than searching harder
     - if a query legitimately returns nothing, say so plainly instead of padding

4. Delete the scaffold's weather agent and weather tool. Register the new agent in
   src/mastra/index.ts. Leave Mastra's own storage exactly as the scaffold has it —
   in-memory is correct for this checkpoint.

5. Add scripts/ask.ts: takes a message as command-line arguments, sends it to the agent,
   prints the reply and then the tool calls it made. Keep it genuinely tiny — the point is
   that there is no machinery here.

Add whatever dependencies this needs to package.json and install them.

Do not add memory, a workflow, a reviewer, or a second agent. If you think one is needed,
stop and say so instead of adding it.
```

**Acceptance check**

```bash
npx tsx scripts/ask.ts "What's on my calendar today?"
```

You should see the reply *and* the tool call printed under it. Find the tool call in the output
before you read the answer — that is the whole lesson.

Now run this one:

```bash
npx tsx scripts/ask.ts "Any PRs waiting for my review?"
```

It will probably guess at who you are, or fail. **That is expected. Do not fix it.** Identity is
prompt 5's problem, and watching it break here is why the fix makes sense later.

**Rescue:** `git checkout checkpoint-1 -- backend/ && cd backend && npm install`

---

## Prompt 2 — Memory

> **Concept:** conversation state scoped by person and by session. **Target:** `checkpoint-2`

```text
Read backend/.agents/skills/mastra/SKILL.md first and follow it. Do not rely on cached
knowledge of the Mastra API.

Goal: the same agent, now remembering who it is talking to and what has already been said —
without re-asking, and across separate conversations.

The important idea is that there are TWO independent scopes, not one: which person this is,
and which conversation this is. Keep them separate everywhere.

Work in backend/.

1. Add a Postgres service in docker-compose.yml — Postgres 16, database 'mastra', mapped to
   host port 5440 so it does not collide with a local install, with a named volume so data
   survives a container restart. Add the matching DATABASE_URL to .env.example and .env.

2. Add src/mastra/memory/index.ts exporting one shared memory instance, backed by that
   Postgres. Configure it to carry a bounded window of recent messages, and to keep
   retained facts separately from the raw transcript — facts the user says are worth
   remembering must survive into a completely different conversation by the same person.

3. Attach that memory to the chat agent, and add one line to its instructions telling it to
   retain things the user says are worth remembering, because it may be asked in a
   different conversation.

   The memory must be scoped per call, not baked into the agent — the same agent instance
   serves every person.

4. Rewrite scripts/ask.ts to take the person id and the conversation id as REQUIRED
   positional arguments, before the message, and pass both to the agent as its memory
   scope. Exit with a usage error if any of the three is missing.

   Required, not optional flags with defaults: if the script runs without them, an attendee
   can complete the demo without ever seeing that the scoping exists, and the demo proves
   nothing. Put the three-command demo in the file's header comment.

5. Leave Mastra's own storage as it is. Only memory gets a real store at this checkpoint.

Add whatever dependencies this needs and install them.
```

**Acceptance check**

Start Postgres first:

```bash
docker compose up -d
```

Then, in order:

```bash
npx tsx scripts/ask.ts alice thread-1 "Hi, remember that my username is alice123"
npx tsx scripts/ask.ts alice thread-1 "What's my username?"    # same conversation
npx tsx scripts/ask.ts alice thread-2 "What's my username?"    # NEW conversation, same person
```

Before you run the third one, say out loud whether you expect it to know. Then run it.

**Rescue:** `git checkout checkpoint-2 -- backend/ && cd backend && npm install`

---

## Prompt 3 — A deterministic pipeline

> **Concept:** fixed step order, enforced by code, not by prompt. **Target:** `checkpoint-3`

```text
Read backend/.agents/skills/mastra/SKILL.md first and follow it. Do not rely on cached
knowledge of the Mastra API.

Goal: a fixed, multi-step data-gathering procedure that runs the same way every time,
because the pipeline decides what runs next — not a model. The running example is standup
prep: every developer's standup covers the same shape every day, so it earns being a real
procedure instead of something improvised turn to turn.

No agent runs this pipeline. That is deliberate — I want the contrast with prompt 1 to be
total.

Work in backend/.

1. In src/mastra/mcp.ts, add a helper that lets code call one MCP tool directly by its
   un-namespaced name, bypassing any agent's tool-calling loop entirely. Two things it has
   to handle: resolving the server's namespace prefix, and unwrapping the response — this
   server returns a plain result object for some tools and the raw MCP text-content
   envelope with JSON inside it for others. Both shapes, one return value.

2. Add src/mastra/agents/standup-synthesis-agent.ts: an agent with NO TOOLS AT ALL. Its
   only job is turning already-gathered data into a short "Yesterday / Today / Blockers"
   summary, tight enough to post in a team channel. Instruct it to use only facts present
   in the data it is given, never to invent ticket ids, PR numbers, names or dates, and to
   say a section is empty plainly rather than omitting it.

   No tools is the point, not an oversight. If it can fetch its own data it will, and then
   the pipeline no longer controls what it sees. Do not attach tools "just in case".

3. Add src/mastra/workflows/standup-workflow.ts — a workflow whose steps run in a fixed
   order you write, taking a user id and a timestamp as input:
     - look up the user profile
     - fetch today's calendar events
     - fetch the Jira tickets assigned to that user, filtered by the email from the profile
     - for each ticket, resolve its linked GitHub PRs
     - reshape that into one flat list of PR ids, then fetch detail for each one
     - fetch recent messages from the standup channel
     - fetch recent email threads
     - synthesize the summary using the agent from step 2, passing it everything gathered

   Four constraints:
     - every data-gathering step calls the MCP server through the helper from step 1. No
       agent is involved in running this workflow.
     - any date argument is a relative word like 'today' or 'this_week', so the server
       resolves it against the real current date. Never compute an absolute date here.
     - keep the step schemas loose rather than mirroring the MCP server's exact shapes;
       this is a teaching pipeline, not a typed client, and precise schemas here just break
       when the server changes.
     - a step that needs an earlier step's result should read it explicitly by name, not
       rely on it arriving as its input. The chain expresses ORDER; it is not the only way
       data moves. Make that visible in how you write it.

   Thread the model call's token usage out of the workflow so a caller can report it later.

4. Register the workflow and the new agent in src/mastra/index.ts.

5. Add scripts/run-standup.ts: create a run, start it, print the status and the summary.
   Nothing else. Its header comment should say plainly that no agent is involved and that
   the order you see is the order the workflow definition sets.
```

**Acceptance check**

```bash
npx tsx scripts/run-standup.ts
```

Watch the steps fire in order. Then do this, because it is the actual lesson:

> Open `standup-workflow.ts`, swap the order of the Slack step and the Gmail step, and run it again.
> The order changes. You changed it, not the model.

Put them back afterwards.

**Rescue:** `git checkout checkpoint-3 -- backend/ && cd backend && npm install`

---

## Prompt 4 — Pause and resume

> **Concept:** a durable human-in-the-loop checkpoint. **Target:** `checkpoint-4`

```text
Read backend/.agents/skills/mastra/SKILL.md first and follow it. Do not rely on cached
knowledge of the Mastra API.

Goal: the standup pipeline now stops and waits for a real human decision before it does
anything irreversible, and picks back up exactly where it left off — from a completely
different process, not an in-memory callback waiting in the background.

Work in backend/.

1. Extend src/mastra/workflows/standup-workflow.ts with three more steps after synthesis:

   - An approval step that suspends the run and hands out the drafted summary as the
     description of the decision it is waiting on. The pause/resume contract must be
     schema-shaped — declare what the suspension emits and what a resume must supply, so a
     caller is not left defensively parsing a loose payload.

   - A post step that runs only after a decision arrives. On approval it performs the real
     write; on refusal it writes nothing and reports that it did nothing. The write must go
     through this MCP server's two-phase write protocol: the write tool only drafts and
     returns a pending action id, and a separate confirm call is the one with side effects.
     Both halves, explicitly.

   - A confirm step that turns the outcome into a human-readable confirmation string,
     covering both the posted and the declined case.

   Keep threading token usage through to the end.

2. In src/mastra/index.ts, change Mastra's own storage from in-memory to something that
   survives this process exiting entirely.

   This is not tidying. The demo below resumes a suspended run from a SECOND, SEPARATE
   terminal invocation — the first process is gone by then. In-memory storage cannot do
   that. Leave a comment saying so, because the next person to read that line will wonder.

3. Rewrite scripts/run-standup.ts to do two jobs:
     - with no arguments: start a run; if it suspends, print the run id and the drafted
       summary, then print the exact commands to resume it either way
     - with a resume flag, a run id and a decision: resume that specific run by its id and
       print the confirmation

   Put the four-step demo in the header comment: start, resume denied, start again, resume
   approved.
```

**Acceptance check**

```bash
npx tsx scripts/run-standup.ts                              # note the run id
npx tsx scripts/run-standup.ts --resume <runId> denied       # nothing gets posted
npx tsx scripts/run-standup.ts                              # new run, new id
npx tsx scripts/run-standup.ts --resume <runId> approved     # now check the real channel
```

Then the part that proves it: **start a run, close the terminal entirely, open a new one, and resume
that run id.** If it works, the state is genuinely persisted. If it does not, your storage change in
step 2 did not land.

**Rescue:** `git checkout checkpoint-4 -- backend/ && cd backend && npm install`

---

## Prompt 5.1 — Pipeline-as-tool and reviewer agent (the pieces)

> **Concept:** the building blocks the mandatory review pipeline needs. **Target:** `checkpoint-5a`
>
> This prompt only builds pieces. Nothing is wired into the chat turn yet — that is 5.2.

```text
Read backend/.agents/skills/mastra/SKILL.md first and follow it. Do not rely on cached
knowledge of the Mastra API.

Goal: build two pieces the next prompt will wire together — the standup pipeline exposed
as a tool pair, and a reviewer agent that judges a reply against the tool-call trace that
produced it. Do not wire either into the chat agent's turn flow yet; that composition,
and the reason the reviewer must not be a tool the model can skip, is the next prompt.

Work in backend/.

1. Add src/mastra/tools/standup-tools.ts: expose the standup workflow to the chat agent as
   a PAIR of ordinary tools — one that starts it, one that resumes it with the user's yes or
   no. The starting tool creates a run, starts it, sees that it suspended, and flattens that
   suspension into a plain tool result carrying the run id and the drafted summary. The
   resuming tool takes a run id and a boolean and returns the outcome.

   The agent must never see a suspended workflow. From its side these are two normal tool
   calls that return JSON. Absorbing the pause at the tool boundary is the entire trick.

2. Add src/mastra/agents/reviewer-agent.ts holding a second agent plus the function a
   pipeline will later call.

   - It runs on a DIFFERENT model family from the chat agent. Add its model to config.ts
     alongside the existing one. Two reasons, both real: schema-forced structured output on
     the same family as the model under test has intermittently returned nothing usable in
     this project, and a judge should not share its subject's blind spots.
   - It receives three things: the current date and time, the drafted reply, and the full
     tool-call trace that produced it — every tool name, its arguments, and its result. A
     reviewer given only the reply text can check style, not truth.
   - It returns a structured verdict: approved or not, a list of issues, and a concrete
     correction request when it rejects. Every field in that structure must be present in
     the schema's required set — an optional field breaks strict structured output on some
     providers with a 400, which is a confusing failure to debug live.
   - Scope it tightly. It flags only: a claim contradicting or absent from the trace; a
     temporal reference that is wrong given the real clock and the trace's timestamps; a
     cross-source link nothing in the trace supports; a write described as done that the
     trace does not show executing. Ranking, grouping, summarising and opinion on top of
     real data are fine and must never be flagged. A reviewer that flags style produces
     noise nobody reads.
   - Cap the size of each tool result before embedding it. A single PR search result has
     blown past the judge's context window here.
   - If the check itself fails, return an unapproved verdict naming the failure rather than
     throwing. A reviewer that crashes takes down the turns it exists to protect.

3. Add src/trace-utils.ts for the pure helpers: pairing tool calls to their results into a
   trace, and iterating an agent's stream.

   This file must NOT import the Mastra singleton. src/mastra/index.ts will end up importing
   the HTTP routes, which import the chat entrypoint — put these helpers anywhere in that
   cycle and you get a circular import that fails in a way that does not point at the cause.

4. Register the new tools and the reviewer agent in src/mastra/index.ts. Do not attach
   standup-tools to the chat agent's instructions yet beyond making the tools available —
   the instruction rewrite that tells it how to use them is part of the next prompt.

Add whatever dependencies this needs and install them.
```

**Acceptance check**

Prove each piece works standalone, without the turn pipeline that will consume it.

Temporarily attach the standup tools to the chat agent from prompt 1 and run it:

```bash
npx tsx scripts/ask.ts alice thread-1 "Can you prep my standup?"
```

Confirm the start tool returns a run id and a drafted summary as a plain tool result — the agent
should never crash on or report a "suspended workflow." Then call the resume tool the same way and
confirm it returns an outcome.

Separately, call the reviewer agent's exported function directly with a hand-built trace (a couple
of fake tool calls and a draft reply) and confirm the verdict comes back with every field the
schema requires, including when you construct a trace on purpose to make it fail.

**Rescue:** no dedicated checkpoint for this half — fall back to `git checkout checkpoint-4 -- backend/ && cd backend && npm install` and redo 5.1.

---

## Prompt 5.2 — Wiring: a review step that cannot be skipped

> **Concept:** composing the agent, the pipeline, and a mandatory check. **Target:** `checkpoint-5`
>
> Assumes 5.1 landed — standup-tools.ts, reviewer-agent.ts and trace-utils.ts already exist.

```text
Read backend/.agents/skills/mastra/SKILL.md first and follow it. Do not rely on cached
knowledge of the Mastra API.

Goal: put a review step in front of every reply the user ever sees — one the model has no
way to opt out of.

Read this before you start. Most frameworks let you hand an agent a "reviewer" as a tool and
instruct it to check its work. That mechanism is discretionary: the model decides, per turn,
whether checking is worth the tokens — and on the turn where it is most confidently wrong, it
is least likely to bother. So the reviewer here is NOT a tool. It is a step in a pipeline that
every single chat turn passes through. Do not implement it as a tool, a sub-agent the model
may delegate to, or a conditional. If you find yourself writing an `if` around whether the
review happens, stop.

Work in backend/.

1. Add src/mastra/workflows/chat-turn-workflow.ts — four steps, and every chat turn runs
   all four:
     - run the chat agent, streaming its output live into the workflow's stream so a caller
       sees tokens, reasoning and tool calls as they happen
     - review the draft against its tool-call trace, using the reviewer agent from 5.1
     - an approval gate (part 2 below)
     - assemble the final result: reply, trace, verdict, token usage

   The agent step must prepend a system message carrying the real current date/time and the
   real user id before the conversation. Without it the model guesses both, and a fabricated
   date fed into the standup tool cascades into eleven data fetches and an invented summary.
   This is an observed failure, not a precaution.

   Accumulate the reply text from the stream's own text chunks rather than trusting the
   stream's aggregate text property — across a multi-tool-call turn that came back empty
   here even though the chunks were correct.

2. Gate exactly ONE MCP tool for human approval in src/mastra/mcp.ts: the confirm call.

   Because the server already splits every write into draft-then-confirm, gating that one
   tool gates every write there is — no allowlist to maintain, nothing to forget when a new
   write tool appears server-side. Note that the gate receives the server's own
   un-namespaced tool name.

   When that gate fires, the agent's stream emits an approval request instead of executing.
   The turn workflow's agent step must detect it and pass it on; the approval gate step
   suspends the whole turn on it, and on resume either approves or declines that specific
   tool call by id and lets the agent's stream continue.

   Two details that matter:
     - When a turn is suspended for a write, there is no final text yet, so the review step
       has nothing to check. It passes through, and the review runs inside the gate after
       resuming instead. Whatever text reaches the user must have been reviewed exactly
       once, against the trace that actually produced it. Keep that invariant true.
     - If a second gated write appears in the same turn, it cannot get its own
       suspend/resume round trip. Decline it rather than letting it execute unapproved.

3. Add src/chat.ts: one streaming entrypoint every caller uses. It creates or resumes a turn
   run, forwards the stream as a series of events, and ends with exactly one of two terminal
   events — an approval-required event carrying the run id, or a finish event carrying reply,
   trace, verdict and usage. Add a non-streaming variant that collects the same run.

4. Add src/chat-routes.ts: two HTTP routes over that entrypoint — one to send a message, one
   to supply an approval decision — each streaming one JSON object per line. Keep it
   stateless: a suspended run resumes purely by its run id, because storage holds the
   snapshot. Nothing waits in memory. Register the routes on the Mastra server in
   src/mastra/index.ts, along with the new workflow. Permissive CORS is fine for the
   workshop; leave a comment saying it is dev-only.

5. Replace scripts/ask.ts with scripts/test-flows.ts — an interactive terminal client for
   the new entrypoint. Delete ask.ts; it cannot demonstrate this composition and leaving a
   stale script around is worse than removing it. The new script should:
     - run one message from the command line, or loop as a REPL with no arguments
     - render streamed reasoning, tool calls with their arguments, and tool results
       distinctly, truncating huge results instead of flooding the terminal
     - print the reviewer's verdict after the reply, and the token usage
     - when a turn suspends for a write, ask for a real y/n at the prompt and resume with it
       — do not auto-approve
     - load .env itself so it runs standalone

6. Rewrite the chat agent's instructions for this composition. Add:
     - Identity: it has no built-in identity for the user and must never assume, invent, or
       reuse an id from elsewhere in the conversation. Before any tool call filtered by
       assignee, author, reviewer or participant, look up the user profile first. Note in
       the instructions which identity fields that profile does and does not return, and
       tell it to ASK the user directly for any identity value no tool can supply, rather
       than substituting a plausible-looking one that will silently match nothing.
     - Dates: always pass relative date words, or an ISO date a tool result already gave it.
       Never compute one. Talk about time the same way in conversation.
     - Standup: call the start tool, then quote the summary it returns back to the user
       VERBATIM and ask a plain yes/no. That summary was grounded in real data the chat
       agent never saw, so re-summarising it can only add fabrication. Then call the resume
       tool with the answer. Never post a standup any other way.
     - Writes: the write tools only draft. As soon as it has drafted one, it must call the
       confirm tool immediately, in the same turn, and must NOT stop to ask the user in chat
       first. This reads backwards, so state the reason in the instructions: asking in chat
       produces a simulation of approval that nothing enforces, whereas calling confirm is
       what triggers the real gate. And it must never tell the user a write is done until
       confirm has actually come back confirmed.
     - A guardrail: if it genuinely cannot proceed without something only the human has, it
       escalates and stops rather than fabricating an answer to fill the gap.

Add whatever dependencies this needs and install them.
```

**Acceptance check**

```bash
npx tsx scripts/test-flows.ts
> Can you prep my standup?
```

You should see the standup tool call, the summary quoted back, the yes/no question — and a reviewer
verdict printed after the reply.

Then the demo the whole checkpoint exists for:

> Comment out the reviewer step in the turn workflow's chain. Re-run the same prompt.
>
> Nothing crashes. No error appears. The verdict is simply **missing**, and nothing about the
> system's visible behaviour says it stopped checking its own work.

This is a regression that really happened in this project, and it was caught only by a routine
re-test noticing a field that should never have been empty. Put the step back.

Also try a write — "post a message in Slack saying I'm blocked" — and answer `n` at the approval
prompt. Confirm nothing was posted.

**Rescue:** `git checkout checkpoint-5 -- backend/ && cd backend && npm install`

---

## Prompt 6 — Evaluation, cost, and swapping models

> **Concept:** automated grading, real usage accounting, swappable models. **Target:** `checkpoint-6`

```text
Read backend/.agents/skills/mastra/SKILL.md first and follow it. Do not rely on cached
knowledge of the Mastra API.

Goal: the three things that are easy to skip in a demo and decide real adoption — automated
scoring, honest token accounting, and changing the model without touching application code.

Work in backend/.

1. Add src/mastra/scorers/no-fabrication-scorer.ts: an evaluation scorer, judged by the same
   different-family model the reviewer uses, that flags any specific factual claim in a
   response — a ticket id, PR number, name, date or status — whose origin cannot be traced.
   Score it as a clean pass or fail, and generate a reason listing what it found.

   Note the difference from the reviewer and put it in a comment: the reviewer checks a reply
   against the TOOL-CALL TRACE, synchronously, in the turn pipeline. This scorer checks a
   reply against the CONVERSATION CONTEXT, asynchronously, out of band. Same concern, two
   definitions of grounded, and a claim can pass one while failing the other. Both are worth
   having.

   Where the judge is asked for a list, default it to empty rather than making it optional —
   the judge often omits the field instead of sending an empty list.

2. Attach the scorer to the chat agent, sampling every response, and register it on the
   Mastra instance so it shows up in Studio.

3. Swap Mastra's storage from the file-backed store to Postgres — the same database the
   memory store has been using since prompt 2. Point the observability store at it too.
   Remove the now-unused storage dependency from package.json rather than leaving it behind.

   Say in a comment that this is a one-line provider swap, the same way the memory store was
   — that portability is the point of the checkpoint, not a side effect.

4. Add observability to the Mastra instance: persist events to storage, and also export to
   the Mastra platform if a platform token is present in the environment. Redact sensitive
   values from span output.

5. Make sure the token usage that has been threaded through since prompt 3 actually reaches
   the terminal — a line after each turn showing input, output and total. It is a real field
   on the response, not something you compute; do not estimate it.

Add whatever dependencies this needs and install them.
```

**Acceptance check**

```bash
npx tsx scripts/test-flows.ts "hi"
```

Point at the token line. It came free with the response.

Then the portability demo:

> Change the chat agent's model to a different family — **one line** in `config.ts`. Re-run the exact
> same command, unmodified. Same script, different model, zero other changes.

Open Mastra Studio (`npm run dev`, then `http://localhost:4111`) and find the scorer's results.

**Rescue:** `git checkout checkpoint-6 -- backend/ && cd backend && npm install`

---

## Prompt 7 — The full assistant

> **Concept:** one agent, no mode flags, deciding for itself. **Target:** `checkpoint-7`

```text
Read backend/.agents/skills/mastra/SKILL.md first and follow it. Do not rely on cached
knowledge of the Mastra API.

Goal: everything so far in one place — one agent handling quick lookups, a fixed procedure,
and open-ended planning, inferring which kind of request it is looking at from the message
alone. No mode input anywhere in the system.

Work in backend/.

1. Add src/mastra/workflows/sprint-prep-workflow.ts: a second fixed pipeline that gathers
   the standard sprint-planning bundle — this week's sprint-planning calendar events, the
   current sprint's tickets, the PRs linked to those tickets and their detail, recent
   engineering-channel Slack, and recent sprint-related email — and returns all of it
   together.

   Three constraints:
     - It is READ-ONLY. No model call, no suspension, no writes. It gathers; the agent that
       called it does the judging. Do not add a synthesis step.
     - Take the current sprint's name from an environment variable, and skip the sprint
       filter entirely when it is unset. The MCP server has no way to resolve "the current
       sprint" itself, so this is a real gap — document it as one in .env.example rather
       than having the model guess a sprint name.
     - Reuse the same relative-date and direct-MCP-call approach as the standup pipeline.

2. Expose it to the chat agent as a workflow the agent can call directly, rather than
   hand-writing a start/resume tool pair like the standup one needed. It never suspends, so
   it does not need that treatment — and the contrast between the two is worth being able to
   point at.

3. Register it on the Mastra instance.

4. Add an open-ended planning section to the chat agent's instructions, and open the
   instructions by telling it that it decides for itself, from the message alone, what kind
   of request this is and how much work it needs — nobody will tell it "this is a quick
   question" or "this is a planning task". Update its description to match all three shapes.

   The planning section should require it to:
     - clarify first if the request is ambiguous about timeframe, project or which meeting,
       rather than guessing at scope
     - gather data across sources before reasoning, and for sprint-planning-shaped requests
       use the sprint-prep workflow to get the standard bundle instead of improvising a
       data-gathering plan by hand
     - reason explicitly about conflicts and priorities — overlapping meetings, blocked
       tickets, stale PRs — not list raw data back at the user
     - present two or three ranked options with a one-line reason each, not one unexplained
       answer

5. Give the agent an explicit default output-token ceiling and high reasoning effort, since
   planning requests are now in scope and the quick-lookup budget is no longer the only
   shape it handles.

6. Update the root README.md to describe the finished system: how a turn flows, where writes
   are gated, which model does what, and how to run it locally.
```

**Acceptance check**

Three prompts, three different shapes, one agent, no flags:

```bash
npx tsx scripts/test-flows.ts
> Any PRs waiting for my review?          # quick lookup — 1-3 tool calls, short answer
> Can you prep my standup?                # fixed procedure — pauses for approval
> Prep me for sprint planning             # open-ended — ranked options come back
```

If all three behave differently and you never told it which was which, you are done.

**Rescue:** `git checkout checkpoint-7 -- backend/ && cd backend && npm install`
