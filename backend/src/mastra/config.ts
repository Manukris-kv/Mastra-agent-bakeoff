import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const LITELLM_URL = `${(process.env.LITELLM_BASE_URL ?? 'https://llm.keyvalue.systems').replace(/\/+$/, '')}/v1`;

const litellm = createOpenAICompatible({
  name: 'litellm',
  baseURL: LITELLM_URL,
  apiKey: process.env.LITELLM_API_KEY,
  includeUsage: true,
  supportsStructuredOutputs: true,
});

// Bare model names (no "provider/" prefix) — we call the provider directly,
// so there's no gateway string to parse.
export const MID_MODEL = litellm('claude-sonnet-4-5');

export const AGENT_TEMPERATURE = 0.3;
