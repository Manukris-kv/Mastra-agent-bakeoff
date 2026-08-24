# Worked example: this repo's 7-checkpoint split

Concrete calibration for Step 4's classification call, from the run that produced this repo's `boilerplate` / `checkpoint-1` .. `checkpoint-7` chain against `AGENT_CHECKPOINTS.md`. All paths are relative to `backend/`.

## boilerplate

The unmodified `npm create mastra@latest` output (per `backend/.agents/skills/mastra/references/create-mastra.md`, this stack's own scaffold guide): `package.json` with only `@mastra/core`/`mastra`/`zod`/`typescript`/`tsx`/`@types/node`/`@mastra/loggers`, the default example `weather-agent.ts` + `weather-tool.ts`, `index.ts` wiring an in-memory `LibSQLStore` + `PinoLogger`. Framework tooling that never changes again — `.gitignore`, `tsconfig.json`, `README.md`, the vendored `mastra` skill under `.agents/skills/` — is introduced here too, once.

## checkpoint-1 — the agent primitive

`config.ts` (model client only), `mcp.ts` (client + tool listing — no `callMcpTool`, no approval gating yet), a trimmed `chat-agent.ts` (no memory, no standup tools, no scorer), `index.ts` registering just that agent, and a five-line `scripts/ask.ts`. The weather example is deleted. Classification call: the MCP client's `requireToolApproval` gate is *not* added here even though the final `mcp.ts` has it — nothing at this checkpoint exercises approval, so it would be dead configuration; it's introduced at checkpoint-5, the first checkpoint whose demo actually suspends on it.

## checkpoint-2 — memory

`memory/index.ts` (new), `chat-agent.ts` gains a `memory:` field, `docker-compose.yml` + `DATABASE_URL` show up because memory is the first thing that needs durable storage. `scripts/ask.ts` is extended to take `(userId, threadId, message)` instead of just `message`, to demo the "same thread vs. brand-new thread, same person" distinction from the checkpoint's own demo script.

## checkpoint-3 — a deterministic pipeline

`mcp.ts` gains `callMcpTool`; `standup-synthesis-agent.ts` and `standup-workflow.ts` are new. Classification call: `standup-workflow.ts` in the final repo is an 11-step workflow, but only steps 1-8 (gather data, then synthesize) land here — steps 9-11 (suspend for approval, post, confirm) are checkpoint-4's, because checkpoint-3's own demo script explicitly says "run it directly... no agent involved yet" with no mention of pausing. A new `scripts/run-standup.ts` replaces nothing (it runs the workflow, not the agent) and coexists with `scripts/ask.ts`.

## checkpoint-4 — pause and resume

`standup-workflow.ts` gains the suspend/resume/post/confirm steps, now matching the final file exactly. `scripts/run-standup.ts` gains a `--resume <runId> <approved|denied>` mode. Classification call that matters most in this whole arc: the top-level Mastra `storage` in `index.ts`, which was `LibSQLStore({ url: ':memory:' })` since `boilerplate`, has to become file-backed (`file:mastra.db`) *here*, not later — an in-memory store can't survive the "kill the terminal, resume from a new process" demo this checkpoint's hands-on explicitly calls for. This wasn't stated anywhere in `AGENT_CHECKPOINTS.md` as a file to change; it was inferred from the demo script's requirement (Step 2's "the live demo script... tells you what a script/entrypoint must actually be able to do").

## checkpoint-5 — pipeline-as-tool + mandatory review

`config.ts` gains a second (judge) model; `mcp.ts` gains `requireToolApproval` gating `confirm_action` — this is the checkpoint whose demo actually suspends on it, per the checkpoint-1 note above. New: `reviewer-agent.ts`, `standup-tools.ts` (wraps the workflow as `start_standup`/`resume_standup`), `trace-utils.ts`, `chat-turn-workflow.ts`, `chat.ts`, `chat-routes.ts`. `chat-agent.ts` gains the standup tools and the matching instruction sections. `scripts/ask.ts` is deleted and `scripts/test-flows.ts` takes over — it's the first script that needs the agent+pipeline+review composition, so it couldn't exist any earlier without being inconsistent with the code around it (Step 6.3).

## checkpoint-6 — evaluation, cost, portability

`no-fabrication-scorer.ts` is new; `chat-agent.ts` wires it in. `index.ts` swaps `storage` from checkpoint-4's file-backed `LibSQLStore` to `PostgresStoreVNext` and adds the `Observability` block — durable storage plus real cost/trace accounting is exactly this checkpoint's theme, not a random infra chore, so it lands here rather than in `boilerplate` "for convenience."

## checkpoint-7 — the full assistant

`sprint-prep-workflow.ts` is new; `chat-agent.ts` gains it as a second workflow-as-tool plus the final "open-ended planning" instruction section; `index.ts` registers it. This is the "compose a second instance of an already-introduced pattern" case from Step 4 — sprint-prep is architecturally identical to checkpoint-3's standup pipeline, but it belongs at the arc's last checkpoint because that's the one whose "why it matters" is specifically about composing everything into one assistant with no mode flag.

## What came out byte-identical to `main`, and what didn't

Diffing `checkpoint-7` against `main` on the application source tree turned up only cosmetic drift (a stray leading blank line in one file) plus one dependency (`@slack/web-api`) present in `main`'s `package.json` but never imported anywhere — confirmed with `git grep` before concluding it was vestigial rather than something Step 3 missed. Everything else — every symbol in every file — matched. That's the bar for Step 7's verification: a clean diff you can account for line by line, not an eyeballed "looks close."
