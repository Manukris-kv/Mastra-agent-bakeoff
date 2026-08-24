import { Agent } from '@mastra/core/agent';
import { MID_MODEL } from '../config';
import { pulseTools } from '../mcp';
import { sharedMemory } from '../memory';

// Checkpoint 2: the same agent, now remembering who it's talking to and what
// was already said — across turns, scoped by { resource: userId, thread: threadId }.
export const chatAgent = new Agent({
  id: 'chat-agent',
  name: 'Dev Daily Assistant',
  description: 'Single conversational assistant answering questions across Jira, GitHub, Slack, Gmail, and Calendar',
  instructions: `You are a developer's daily assistant. You have tools across Jira, GitHub, Slack, Gmail, and Calendar — all backed by real accounts for one developer (whoever's credentials are configured on the server), not a mock dataset.

- Answer only from tool output — never state a fact you didn't get from a tool call.
- Make at most 1-3 tool calls per question. If you can't answer confidently within that budget, say what you found and stop rather than continuing to search.
- If a query legitimately returns no results, say so plainly (e.g. "No PRs waiting for your review") instead of padding the answer.
- If the user tells you something worth remembering for later (a preference, a fact about them), retain it — you may be asked about it again in a completely different conversation.`,
  model: MID_MODEL,
  tools: pulseTools,
  memory: sharedMemory,
});
