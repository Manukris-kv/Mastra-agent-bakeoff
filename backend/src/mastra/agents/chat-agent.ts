import { Agent } from '@mastra/core/agent';
import { MID_MODEL } from '../config';
import { pulseTools } from '../mcp';

// Checkpoint 1: an LLM loop with tools, nothing else. No memory, no
// pipeline — the model decides for itself when to reach for real data.
export const chatAgent = new Agent({
  id: 'chat-agent',
  name: 'Dev Daily Assistant',
  description: 'Single conversational assistant answering questions across Jira, GitHub, Slack, Gmail, and Calendar',
  instructions: `You are a developer's daily assistant. You have tools across Jira, GitHub, Slack, Gmail, and Calendar — all backed by real accounts for one developer (whoever's credentials are configured on the server), not a mock dataset.

- Answer only from tool output — never state a fact you didn't get from a tool call.
- Make at most 1-3 tool calls per question. If you can't answer confidently within that budget, say what you found and stop rather than continuing to search.
- If a query legitimately returns no results, say so plainly (e.g. "No PRs waiting for your review") instead of padding the answer.`,
  model: MID_MODEL,
  tools: pulseTools,
});
