// Single source of truth for model/temperature choices. Routed through
// OpenRouter (OPENROUTER_API_KEY) rather than calling Anthropic directly.

export const MID_MODEL = 'openrouter/anthropic/claude-sonnet-4';

// Swap MID_MODEL usages to this for the ceiling-run comparison.
export const PREMIUM_MODEL = 'openrouter/anthropic/claude-opus-4.8';

// Reviewer/scorer only, deliberately a different model family: Anthropic's
// tool-forced structured output via OpenRouter intermittently returned a bare
// `[]` on large traces; OpenAI's response_format ran the same trace clean.
export const JUDGE_MODEL = 'openrouter/openai/gpt-5.4-mini';

export const AGENT_TEMPERATURE = 0.3;
