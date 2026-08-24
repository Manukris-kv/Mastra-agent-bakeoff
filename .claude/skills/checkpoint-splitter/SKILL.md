---
name: checkpoint-splitter
description: Split (or resync) this repo's finished agent into the branch-per-checkpoint teaching arc described by AGENT_CHECKPOINTS.md — a linear boilerplate -> checkpoint-1 -> ... -> checkpoint-N branch chain. Use when asked to "split into checkpoints", "build the checkpoint branches", or "the checkpoint branches are stale / main changed, update them".
---

# Checkpoint splitter

Turns one finished agent codebase into a linear chain of branches — `boilerplate`, then `checkpoint-1` through `checkpoint-N` — each one the smallest addition that gets you from the previous checkpoint to the next, ending at (or resyncing with) the current `main`. `AGENT_CHECKPOINTS.md` at the repo root is the spec: it names the checkpoints, their order, and — critically — a "why it matters" bullet list per checkpoint that doubles as the classifier for which code belongs where. Read it fresh every run; don't rely on a past run's memory of it, since it's the thing most likely to have changed.

A worked example of this exact split (this repo, `AGENT_CHECKPOINTS.md`'s 7-checkpoint arc) is in [`references/mastra-bakeoff-example.md`](references/mastra-bakeoff-example.md) — read it once for calibration before the first run in a new repo, or whenever a classification call feels ambiguous.

## Step 1 — Decide: fresh build or resync

```
git branch --list 'checkpoint-*' 'boilerplate'
```

- **No checkpoint branches exist yet** → go to Step 2 (fresh build).
- **They exist** → diff the last one in the chain against `main`:
  `git diff <last-checkpoint> main -- <the paths AGENT_CHECKPOINTS.md's system covers>`
  - **Empty diff** → chain is current. Report that and stop.
  - **Non-empty diff** → this is a resync. Go to Step 5.

Done when you know which of the two paths you're on and, for a resync, have the literal diff in hand.

## Step 2 — Read the spec

Read `AGENT_CHECKPOINTS.md` end to end. For each checkpoint, extract:

- its **core concept** (one line — this is the checkpoint's leading word; use it in commit messages and code comments so the narrative stays legible from `git log` alone)
- **"What you build"** — the concrete artifacts
- **"Why it matters"** bullets — this is the classifier you'll use in Step 4 and Step 6. Every bullet implies a rule like "X shows up starting here, not before."
- the **live demo script** — tells you what a script/entrypoint at that checkpoint must actually be able to do; if the demo needs two separate process invocations (pause/resume), the checkpoint's storage must be durable by then, not in-memory.

Done when you can state, for every checkpoint, the one-sentence reason it exists and the one concrete thing its demo requires working.

## Step 3 — Read the target codebase

Read every file `main` (or the current tip) touches under the application's source tree — not summaries, the actual files. For each file, note every distinct symbol, config block, or instruction-text section inside it; a single file routinely spans several checkpoints (e.g. an agent's config object gains one new field per checkpoint; a workflow gains three more steps at the pause/resume checkpoint). Also check for a framework scaffold reference (a `create-<framework>` guide, a "getting started" doc, an official CLI's default template) — `boilerplate` should be that framework's actual unmodified starting point, not an invented minimal stub, so the arc starts from something attendees would recognize.

Done when you have, per file, the list of symbols/sections it contains and no unread file left under the covered source tree.

## Step 4 — Classify every symbol to a checkpoint

For each symbol/section from Step 3, match it against the "why it matters" bullets from Step 2 and assign it the checkpoint whose bullet it satisfies. A few patterns that recur across arcs like this one:

- A capability that must work **without** a later checkpoint's mechanism (e.g. an agent answering questions with no persisted state) belongs at the earliest checkpoint whose demo doesn't need that mechanism yet — don't pull it forward just because the final file already has it.
- A gating/approval mechanism (human-in-the-loop, a mandatory check, a tool-approval hook) belongs at the checkpoint whose demo script is the first to actually exercise it — not wherever it happens to live in the final file's import order.
- A second instance of a pattern already introduced (a second workflow-as-tool, a second scored dimension) belongs at whichever checkpoint's "why it matters" frames the *composition* of the pattern, usually the last checkpoint in the arc.
- Tooling/scaffold files (lint config, framework-provided skills or docs, README boilerplate that's never actually customized even in the final repo) belong in `boilerplate` and never change again — they're not part of the narrative.
- A storage/backend swap mentioned as an aside in one checkpoint's "why it matters" (e.g. "swappable — lightweight for demo, durable for production") is a real signal, not throwaway color: check the *next* checkpoint's demo script for a requirement (surviving a process restart, concurrent access) that the earlier backend can't satisfy, and put the swap at the earliest checkpoint whose demo actually needs it.

Write this out explicitly as a table (symbol/file -> checkpoint) before touching git — the table is what you build from in Step 6, and it's what you diff Step 3's output against on a future resync.

Done when every symbol from Step 3 has exactly one checkpoint assigned, with a one-clause reason citing the "why it matters" bullet it matches.

## Step 5 — Resync only: localize the blast radius

Skip this step on a fresh build. On a resync, map the diff from Step 1 through the Step 4 classification table:

- Find the **earliest** checkpoint touched by the diff.
- Everything before it is untouched — leave those branches exactly as they are.
- That checkpoint and every one after it get rebuilt: recreate the branch from its (possibly just-rebuilt) parent, reapplying that checkpoint's file set with the diff's changes folded in, per Step 6.
- If the diff adds a symbol with no obvious checkpoint home, re-run Step 4's classification for that symbol alone before rebuilding.

Done when you have a concrete "rebuild checkpoints K..N, leave 1..K-1 alone" plan, K being the earliest touched checkpoint.

## Step 6 — Build the branches

`boilerplate` is an orphan branch (`git checkout --orphan boilerplate`, then clear the index) — it shares no history with `main`; its content is the framework scaffold from Step 3, not a stripped-down copy of the final app. Every `checkpoint-N` branches from `checkpoint-N-1` (or `boilerplate` for `checkpoint-1`).

For each checkpoint in order:

1. `git checkout -b checkpoint-N checkpoint-N-1`
2. Add/edit only the files and symbols Step 4 assigned to this checkpoint. Update the manifest (`package.json` deps, `.env.example`, `docker-compose.yml`, etc.) alongside the code that needs it, not in a batch at the end.
3. Any entrypoint script demonstrating this checkpoint must match what the checkpoint can actually do — a script that needs an agent-plus-pipeline composition can't exist before the checkpoint that composes them; an earlier, simpler script gets extended or replaced, not left inconsistent with the code around it.
4. Install and typecheck (`npm install && npx tsc --noEmit`, or the repo's real equivalents) before committing. Fix errors before moving on — an error compounds into every downstream checkpoint otherwise.
5. Commit with a message naming the checkpoint's core concept and, in the body, its "why it matters" reason — this is the log a facilitator reads to remember why the branch exists.

Done when every branch in the chain typechecks clean and its own commit is in place.

## Step 7 — Verify

- `npx tsc --noEmit` (or repo equivalent) passes on every branch in the chain, checked out one at a time.
- `git diff <last-checkpoint> main -- <covered source tree>` is empty or only trivial (whitespace, an unused/vestigial dependency never actually imported, a comment). List anything non-trivial explicitly rather than silently accepting it — it usually means Step 4 misclassified something.
- `git log --graph --oneline --all` shows the intended linear chain.

Done when the diff in the second bullet is accounted for line by line, not just eyeballed as "looks close."

## Step 8 — Pushing

Building and committing branches is local and reversible; pushing is not (it's visible to everyone else with access to the remote). Building the chain never implies push authorization. Ask before pushing, every run — a yes on a past run doesn't carry forward to this one — unless the user's request already explicitly named pushing as part of the ask.
