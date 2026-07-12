// Single source of truth for model/temperature/tool-set choices.
// Every agent and workflow imports from here so the bake-off's fairness rule
// ("one model, one temperature, one tool set... held constant") is structurally enforced.

// Routed through OpenRouter (env var: OPENROUTER_API_KEY) rather than calling
// Anthropic directly — same models, different gateway.

// Mid-tier model used for all scored runs.
export const MID_MODEL = 'openrouter/anthropic/claude-sonnet-4';

// Premium model reserved for the ceiling run — swap MID_MODEL usages to this
// constant when running the ceiling comparison, never hardcode a model string elsewhere.
export const PREMIUM_MODEL = 'openrouter/anthropic/claude-opus-4.8';

// Judge model for the reviewer sub-agent and no-fabrication scorer only —
// infra/QA tooling, not the agent under test, so it's exempt from the
// "one model held constant" fairness rule above. Deliberately a different
// model family (OpenAI, not Anthropic) from MID_MODEL, confirmed by direct
// A/B test (same schema, same large Mode-3 trace): Anthropic's tool-forced
// structured output via OpenRouter would sometimes return a bare empty `[]`
// instead of the schema'd object — not the schema-required-fields bug fixed
// in reviewer-agent.ts (that was real and separate), a distinct failure that
// only showed up on the largest trace. OpenAI's response_format/JSON mode
// ran the identical trace with zero failures, so it stays the judge model.
export const JUDGE_MODEL = 'openrouter/openai/gpt-5.4-mini';

export const AGENT_TEMPERATURE = 0.3;

// There's no equivalent of a "known user roster" anymore: the mock data
// server (../mcp.ts) is single-user (Aisha Khan, see get_user_profile) —
// our own app-level `userId`/`threadId` (memory scoping, conversation
// identity) is unrelated to it and can be any string.
