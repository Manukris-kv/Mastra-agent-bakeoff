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
   LITELLM_API_KEY, and bare model names with no provider prefix.

   Build the provider with createOpenAICompatible from @ai-sdk/openai-compatible, called
   directly — not Mastra's own {id, url, apiKey} model-router shorthand. That shorthand
   never sets includeUsage, so token-usage fields silently disappear from every response for litellm.
   Pass includeUsage: true, and supportsStructuredOutputs: true.

   Export the agent's model as a single named constant — later in this workshop swapping
   model families has to be a one-line change here, so build for that now.

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

5. Point Mastra's own storage at the same Postgres instance too, instead of leaving it on its
   default store.

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

2. Mastra's own storage already points at Postgres since prompt 2, so it survives this
   process exiting entirely — nothing to change here. The demo below resumes a suspended
   run from a SECOND, SEPARATE terminal invocation; leave a comment on the storage config
   noting that this is exactly why it needs to be durable, because the next person to read
   that line will wonder.

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
that run id.** If it works, the state is genuinely persisted. If it does not, the Postgres storage
from prompt 2 did not land.

**Rescue:** `git checkout checkpoint-4 -- backend/ && cd backend && npm install`

---

## Prompt 5.1 — Pipeline-as-tool, and the chat turn workflow

> **Concept:** absorbing a suspending workflow behind an ordinary tool call, plus one workflow wrapping every chat turn with live streaming and a human gate on writes. **Target:** `checkpoint-5a`

```text
Read backend/.agents/skills/mastra/SKILL.md first and follow it. Do not rely on cached
knowledge of the Mastra API.

Goal: expose the standup pipeline to the chat agent as an ordinary pair of tools, without it
ever seeing that a workflow underneath it suspended, and put every chat turn through its own
workflow so a spontaneous write also stops for a real human decision first. No reviewer yet
— that is the next prompt, added on top of a pipeline that already works without it.

Work in backend/.

1. Add src/mastra/tools/standup-tools.ts: expose the standup workflow to the chat agent as
   a PAIR of ordinary tools — one that starts it, one that resumes it with the user's yes or
   no. The starting tool creates a run, starts it, sees that it suspended, and flattens that
   suspension into a plain tool result carrying the run id and the drafted summary. The
   resuming tool takes a run id and a boolean and returns the outcome.

   The agent must never see a suspended workflow. From its side these are two normal tool
   calls that return JSON. Absorbing the pause at the tool boundary is the entire trick.

2. Attach both tools to the chat agent alongside its MCP tools.

3. Add src/trace-utils.ts for the pure helpers this prompt needs: shared message/chunk
   types, converting a plain message into the model's own shape, and iterating an agent's
   stream to forward chunks live while watching for a tool-call-approval chunk.

   Keep this file free of any Mastra import. Both chat-turn-workflow.ts (step 4) and chat.ts
   (step 6) need it, and chat-turn-workflow.ts importing from chat.ts would mean the
   workflow depending on its own consumer.

4. Add src/mastra/workflows/chat-turn-workflow.ts — three steps, and every chat turn runs
   all three:
     - run the chat agent, streaming its output live into the workflow's stream (via the
       helper from step 3) so a caller sees tokens, reasoning and tool calls as they happen
     - an approval gate (part 5 below)
     - assemble the final result: reply and token usage

   The agent step must prepend a system message carrying the real current date/time and the
   real user id before the conversation. Without it the model guesses both, and a fabricated
   date fed into the standup tool cascades into eleven data fetches and an invented summary.
   This is an observed failure, not a precaution.

   Accumulate the reply text from the stream's own text chunks rather than trusting the
   stream's aggregate text property — across a multi-tool-call turn that came back empty
   here even though the chunks were correct.

5. Gate exactly ONE MCP tool for human approval in src/mastra/mcp.ts: the confirm call.

   Because the server already splits every write into draft-then-confirm, gating that one
   tool gates every write there is — no allowlist to maintain, nothing to forget when a new
   write tool appears server-side. Note that the gate receives the server's own
   un-namespaced tool name.

   When that gate fires, the agent's stream emits an approval request instead of executing.
   The turn workflow's agent step must detect it and pass it on; the approval gate step
   suspends the whole turn on it, and on resume either approves or declines that specific
   tool call by id and lets the agent's stream continue.

   If a second gated write appears in the same turn, it cannot get its own suspend/resume
   round trip. Decline it rather than letting it execute unapproved.

6. Add src/chat.ts: one streaming entrypoint every caller uses. It creates or resumes a turn
   run, forwards the stream as a series of events, and ends with exactly one of two terminal
   events — an approval-required event carrying the run id, or a finish event carrying the
   reply and usage.

   Import mastra lazily, inside the function, not as a static top-level import — a caller
   that loads its own .env (test-flows.ts, next) needs its environment set before mastra's
   modules construct their storage and model clients at import time.

7. Add scripts/test-flows.ts: an interactive terminal client for the new entrypoint. Delete
   ask.ts; it cannot demonstrate this composition and leaving a stale script around is worse
   than removing it. The new script should:
     - run one message from the command line, or loop as a REPL with no arguments
     - render streamed reasoning, tool calls with their arguments, and tool results
       distinctly, truncating huge results instead of flooding the terminal
     - print the token usage after the reply
     - when a turn suspends for a write, ask for a real y/n at the prompt and resume with it
       — do not auto-approve
     - load .env itself so it runs standalone

8. Register the new workflow in src/mastra/index.ts.

9. Rewrite the chat agent's instructions for this composition. Add:
     - Identity: no built-in user identity — never assume, invent, or reuse one. Look up the
       user profile before any tool call filtered by assignee, author, reviewer or
       participant, note which identity fields it does and doesn't return, and ASK the user
       for anything no tool can supply rather than guessing.
     - Dates: relative words only, or an ISO date a tool already gave it — never compute one.
     - Standup: call the start tool, quote the summary back VERBATIM, ask a plain yes/no,
       then call the resume tool with the answer. Never post a standup any other way.
     - Writes: draft tools only draft. Call confirm immediately, same turn, without asking
       in chat first — confirm is the real gate, asking in chat is not. Never say a write is
       done before confirm returns confirmed.
     - Guardrail: escalate and stop, rather than fabricate, when it's missing something only
       the human has.

Add whatever dependencies this needs and install them.
```

**Acceptance check**

```bash
npx tsx scripts/test-flows.ts
> Can you prep my standup?
```

You should see the standup tool call, the summary quoted back, the yes/no question, and the reply
after you answer. There is no reviewer verdict yet — that is the next prompt.

Now try a write:

```bash
> post a message in Slack saying I'm blocked
```

Answer `n` at the approval prompt and confirm nothing was posted. Ask again and answer `y`, and
confirm it was.

**Rescue:** `git checkout checkpoint-5a -- backend/ && cd backend && npm install`

---

## Prompt 5.2 — A review step that cannot be skipped

> **Concept:** a mandatory grounding check, on every turn, that the model cannot opt out of. **Target:** `checkpoint-5`
>
> Assumes 5.1 landed — chat-turn-workflow.ts, chat.ts and test-flows.ts already exist and work end
> to end, just with no check on what the agent says before it reaches the user.

```text
Read backend/.agents/skills/mastra/SKILL.md first and follow it. Do not rely on cached
knowledge of the Mastra API.

Goal: build a reviewer, then plug it into the turn pipeline from the last prompt so every
reply the user ever sees passes through it, with no way for the model to opt out.

Read this before you start. Most frameworks let you hand an agent a "reviewer" as a tool and
instruct it to check its work. That mechanism is discretionary: the model decides, per turn,
whether checking is worth the tokens — and on the turn where it is most confidently wrong, it
is least likely to bother. So the reviewer here is NOT a tool, a sub-agent the model may
delegate to, or a conditional — it is a step wired directly into chat-turn-workflow.ts's own
chain. If you find yourself writing an `if` around whether the review happens, stop.

Work in backend/.

1. Add src/mastra/agents/reviewer-agent.ts holding a second agent plus the function the
   workflow will call.

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

2. Extend src/trace-utils.ts (from 5.1) with what the reviewer needs that streaming alone
   did not: a trace type, and a helper that pairs an agent's tool calls to their matching
   results into a flat list of {tool, args, result}. This stays a pure, Mastra-free helper
   for the same reason the rest of the file is.

3. Insert a review step into chat-turn-workflow.ts's existing chain, between the agent step
   and the approval gate: build the trace (step 2), call the reviewer (step 1) with the
   draft, the trace, and the current date/time, and thread the verdict through to the
   workflow's result.

   Keep "every reply was reviewed exactly once" true through a suspend:
     - A turn suspended for a write has no final text yet, so this step passes the
       pending-approval state through untouched.
     - The approval gate step from 5.1 must itself call the reviewer once a write is
       approved or declined and the agent's stream continues — otherwise that path reaches
       the user with no review at all.

4. Register the reviewer agent in src/mastra/index.ts.

5. Update scripts/test-flows.ts to print the reviewer's verdict after the reply.

Add whatever dependencies this needs and install them.
```

**Acceptance check**

```bash
npx tsx scripts/test-flows.ts
> Can you prep my standup?
```

You should see the same flow as 5.1 — the standup tool call, the summary quoted back, the yes/no
question — plus a reviewer verdict printed after the reply, which was missing before.

Then the demo the whole checkpoint exists for:

> Comment out the reviewer step in the turn workflow's chain. Re-run the same prompt.
>
> Nothing crashes. No error appears. The verdict is simply **missing**, and nothing about the
> system's visible behaviour says it stopped checking its own work.

This is a regression that really happened in this project, and it was caught only by a routine
re-test noticing a field that should never have been empty. Put the step back.

Also re-run the write from 5.1's acceptance check ("post a message in Slack saying I'm blocked")
and confirm a verdict is printed for that reply too — the review must fire on the write path, not
just the plain-answer path.

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

3. Mastra's storage has been on Postgres since prompt 2 — the same database the memory store
   uses. Point the observability store at it too.

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

