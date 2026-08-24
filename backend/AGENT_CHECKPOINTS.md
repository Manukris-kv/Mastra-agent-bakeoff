# Agent-Bakeoff Checkpoints

*Facilitator plan — terminal-based demo + hands-on session*

**Product:** a daily assistant for a developer — standup prep, quick lookups on tickets/PRs, open-ended day planning. Data sources: issue tracker, code host, chat, calendar, over MCP.

**Arc:** tool use → memory → deterministic pipeline → human approval → mandatory review → evaluation/cost → model portability. Seven checkpoints, each additive.

---

## Prep checklist

- [ ] MCP data server running, real credentials, verified once
- [ ] Database up for conversation state
- [ ] Model access confirmed (run one real completion)
- [ ] Git tag/branch per checkpoint (`checkpoint-1` … `checkpoint-7`) for instant recovery
- [ ] Fresh test identity picked (memory persists per user — avoid stale state)

---

## The arc, at a glance

| Checkpoint | Title | Core concept | Time |
|---|---|---|---|
| `checkpoint-1` | The agent primitive | An LLM loop with tools, nothing else | ~25 min |
| `checkpoint-2` | Memory | Conversation state scoped by user and by session | ~20 min |
| `checkpoint-3` | A deterministic pipeline | Fixed step order, enforced by code, not by prompt | ~30 min |
| `checkpoint-4` | Pause and resume | A durable human-in-the-loop checkpoint | ~30 min |
| `checkpoint-5` | Pipeline-as-tool + a review step | Composing the agent, the pipeline, and a mandatory check | ~35 min |
| `checkpoint-6` | Evaluation, cost, and portability | Automated grading, real usage accounting, swappable models | ~25 min |
| `checkpoint-7` | The full assistant | One agent, no mode flags, deciding for itself | ~25 min |

---

## The checkpoints

### `checkpoint-1` — The agent primitive
**Core concept:** An LLM loop with tools, nothing else · **~25 min**

One agent, wired to two or three real tools over MCP, answering questions by calling them. No memory, no pipeline — just the smallest thing that proves a model can reach real data and decide for itself when to use it.

**What you build**
- Connect to the MCP server and list its available tools
- Construct an agent (model + instructions + those tools attached)
- A five-line script that sends it a message and prints the reply, including which tools it called along the way

**Why it matters**
- A tool is just a typed function description the model can choose to call — there's no magic in "the agent used a tool"
- Tool names arriving from an external server are usually namespaced — worth naming out loud so it isn't a mystery later
- This is the floor everything else in the workshop builds on

**Live demo script**
```
1. run "What's on my calendar today?"
   — point out the tool call in the trace before the reply lands

2. run "Any PRs waiting for my review?"
   — it'll likely guess or fail on identity; flag this, don't fix it yet — checkpoint-2/5 territory
```

**Hands-on:** attendees add a third tool of their choice to the agent and ask a question only that tool can answer.

---

### `checkpoint-2` — Memory
**Core concept:** Conversation state scoped by user and by session · **~20 min**

The same agent, now remembering who it's talking to and what's already been said — across turns, without re-asking.

**What you build**
- A memory layer backed by real storage, keyed by two ids: who the person is, and which conversation this is
- Facts the agent should retain persisted separately from the raw back-and-forth transcript

**Why it matters**
- "Who the person is" and "which conversation this is" are two different scopes — worth drawing on a whiteboard
- Retained facts commonly outlive a single conversation, scoped to the person rather than the thread — a real, sometimes-surprising behavior
- The storage backend underneath is normally swappable — a lightweight file-based store for the demo, something durable for production

**Live demo script**
```
1. run "Hi, remember that my username is X"                         (turn 1)
2. run "What's my username?"                                        (same conversation — it knows)
3. run "What's my username?"                                        (a BRAND NEW conversation, same
   person — still knows: retained memory, not just this transcript)
```

**Hands-on:** attendees run the same three-step script under their own identity and predict — before running step 3 — whether it'll remember.

---

### `checkpoint-3` — A deterministic pipeline
**Core concept:** Fixed step order, enforced by code, not by prompt · **~30 min**

A fixed, multi-step data-gathering procedure that runs the same way every time — because the pipeline decides what runs next, not the model. The running example: a standup update. Every developer's standup covers the same shape every day — what shipped, what's next, what's blocked — so it earns being a real procedure instead of something improvised turn to turn.

**What you build**
- 3–4 steps: fetch the developer's profile → fetch their open tickets → fetch their calendar → one step that asks an LLM to synthesize the gathered data into a standup update
- A pipeline definition that chains those steps in a fixed order
- Run it directly, with no agent involved yet, and watch each step fire in sequence

**Why it matters**
- Contrast directly with checkpoint-1: here, *you* decide the order, not the model
- A step can freely mix plain deterministic code and one real LLM call — order is fixed, what happens inside a step isn't
- Real procedures (a standup, an onboarding checklist, a compliance workflow) are exactly this shape: known steps, known order, no room for the model to improvise the sequence

**Live demo script**
```
1. run the pipeline
   — narrate each step firing in the fixed order as it streams

2. Open the file, reorder two steps, run again — show the order actually changes.
```

**Hands-on:** attendees add a step that fetches detail for every item found in the second step, once per item.

---

### `checkpoint-4` — Pause and resume
**Core concept:** A durable human-in-the-loop checkpoint · **~30 min**

The same pipeline now stops and waits for a real human decision before doing anything irreversible — and picks back up exactly where it left off, even in a different process entirely.

**What you build**
- A step that pauses the pipeline and returns a description of the decision it's waiting on
- A follow-up step that only proceeds once an explicit approve/deny decision arrives, and only then calls the real write action (the data server's own draft → confirm write pattern)
- A second, separate script invocation that supplies that decision and resumes the exact paused run by its id

**Why it matters**
- The pause/resume contract should be schema-shaped, not a loosely-defined payload the caller has to defensively parse
- State genuinely persists — resuming is a separate process invocation, not an in-memory callback waiting in the background
- This is the load-bearing pattern behind any agent that's allowed to take a real, hard-to-undo action

**Live demo script**
```
1. run the pipeline
   — it pauses; note the printed run id

2. resume that run id with "denied"
   — show nothing was written

3. run the pipeline again, then resume with "approved"
   — now check the real system for the write
```

**Hands-on:** attendees kill the terminal between pausing and resuming, then resume anyway from a brand-new process — proving the state really is durable, not just held in memory.

---

### `checkpoint-5` — Pipeline-as-tool, and a review step that can't be skipped
**Core concept:** Composing the agent, the pipeline, and a mandatory check · **~35 min**

Wrap the checkpoint-3/4 pipeline as a tool the checkpoint-1/2 agent can call — then add a review step that checks every draft reply against the trace of tool calls that produced it, before anything reaches the user, every single time, with no way for the model to opt out.

**What you build**
- The pipeline exposed to the agent as a start/resume tool pair, so the agent just sees two ordinary tools, never a paused pipeline underneath
- An outer turn pipeline: agent responds → a review step checks it → the pause-and-resume gate from checkpoint-4 → final answer
- The reviewer is a plain, unconditional function call to a second, small model — **not** delegation the first model can choose to skip

**Why it matters**
- Native "delegate to a second opinion" mechanisms are usually discretionary — the first model decides, per turn, whether to bother
- A check that must run unconditionally (compliance, grounding, safety) needs to be a forced step in the pipeline, not something offered to the model as an option
- A real regression this project hit: this exact step was accidentally commented out of the pipeline once. Nothing crashed. The system quietly stopped checking its own work, and nothing about its visible behavior said so — it was only caught by a routine re-test noticing a field that should never have come back empty.

**Live demo script**
```
1. run "Can you prep my standup?"
   — show the review verdict printed after the reply: approved, clean

2. Comment out the review step live, re-run the same prompt —
   the review result is now missing entirely. Put it back.
   This is the actual regression this project hit — a great "why does this matter" moment.
```

**Hands-on:** attendees ask something the model is likely to over-answer (summarize something with an opinion baked in, for instance) and read the reviewer's correction request together.

---

### `checkpoint-6` — Evaluation, cost, and swapping models
**Core concept:** Automated grading, real usage accounting, swappable models · **~25 min**

The parts of an agent system that are easy to miss in a quick demo but matter most in a real adoption decision: automated scoring of responses, real token accounting with zero extra setup, and changing model providers without touching application code.

**What you build**
- An automated grader attached to the agent that checks each response against a rubric (e.g. "does every factual claim trace to a tool result?")
- Print real token usage after a turn — input, output, total — straight off the same call that produced the reply
- Swap the underlying model in one line of config and re-run the exact same script unmodified

**Why it matters**
- Token counts are commonly a real, zero-setup field on the base response — converting that to a dollar figure is usually the actual (narrower) gap, not the token count itself
- The grading/reviewing model should be a *different model family* from the model under test — schema-forced structured output on some model families intermittently returns nothing usable; this was a real, reproduced bug in this project's own build
- Model portability being a one-line config change, not a rewrite, is one of the strongest arguments for standardizing on a real framework at all

**Live demo script**
```
1. run "hi"
   — point at the printed token line

2. Swap the model config to a different provider, re-run —
   same script, different model, zero other changes
```

**Hands-on:** attendees write one grading check for a failure mode they personally care about (tone, verbosity, a specific compliance rule) and run it against a real transcript.

---

### `checkpoint-7` — The full assistant
**Core concept:** One agent, no mode flags, deciding for itself · **~25 min**

Everything so far, in one place: a single developer's daily assistant handling quick lookups, a fixed procedure (the standup pipeline), and open-ended planning (prepping for sprint planning) — inferring which kind of request it's looking at from the message alone.

**What you build**
- Register a second pipeline-as-tool (a sprint-planning-prep bundle: calendar, sprint tickets, PR status, chat, email, gathered together) alongside the first on the same agent
- One instructions block covering all three request shapes — no external "mode" input anywhere
- The complete reference build this whole arc has been assembling, one concept at a time

**Why it matters**
- A real assistant is never told "this is a quick question" — it has to infer scope itself, every time, the way the room's actual users will use it
- This is the payoff moment: every earlier checkpoint is a load-bearing piece of this one system, not a separate demo

**Live demo script**
```
1. run "Any PRs waiting for my review?"        — quick lookup, 1–2 tool calls
2. run "Can you prep my standup?"              — fixed procedure, pauses for approval
3. run "Prep me for sprint planning"           — open-ended, ranked options back
```