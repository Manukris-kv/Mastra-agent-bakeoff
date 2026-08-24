# Mastra Bake-Off — Dev Daily Assistant

A single conversational agent that helps a developer with standup prep, quick lookups, and open-ended planning across Jira, GitHub, Slack, Gmail, and Calendar.

## How it works

- **Chat agent** (`chat-agent`) decides per-message whether a request is a quick lookup, a standup, or open-ended planning, and picks its own tool budget accordingly.
- **Data access** goes through an external MCP server (Pulse), which wraps real Jira, GitHub, Slack, Gmail, and Calendar accounts for one configured developer — not mock data.
- **Writes** (Jira updates, Slack posts, emails) are draft-then-confirm: the agent drafts via the MCP tool, then calls `confirm_action`, which is gated behind a human approval step (`requireToolApproval`) before anything actually happens.
- **Standup prep** is a dedicated workflow exposed to the agent as `start_standup` / `resume_standup` tools — it gathers calendar, tickets, PRs, Slack, and email, then asks the user to approve the generated summary before anything is posted.
- **Sprint prep** is a second workflow the agent can call directly for sprint-planning-shaped requests, bundling the same data sources.
- **Every chat turn** runs through a workflow: agent step → reviewer step (checks the draft reply against its own tool-call trace for fabrication) → approval gate (suspends if a write needs human sign-off) → finalize.
- **Models** are routed through LiteLLM (`src/mastra/config.ts`): the main agent and the reviewer/judge deliberately use different model families.
- **Storage & memory** use Postgres (`PostgresStoreVNext`) for threads, working memory, and observability data.

## Running locally

```bash
cd backend
docker compose up -d          # Postgres
npm install
npm run dev                   # mastra dev
```

Required env vars (see `backend/.env.example`): `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `PULSE_MCP_URL`, `DATABASE_URL`, and optionally `JIRA_CURRENT_SPRINT`.

To exercise the chat flow from the terminal:

```bash
cd backend
npx tsx scripts/test-flows.ts            # interactive
npx tsx scripts/test-flows.ts "message"  # single turn
```

## Checkpoints

This is the final state of the [`AGENT_CHECKPOINTS.md`](AGENT_CHECKPOINTS.md) arc. Check out `boilerplate` through `checkpoint-7` to see it built up one concept at a time:

```
boilerplate → checkpoint-1 → checkpoint-2 → ... → checkpoint-7 (this branch)
```
