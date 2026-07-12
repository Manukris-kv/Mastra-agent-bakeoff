import { Agent } from '@mastra/core/agent';
import { MID_MODEL, AGENT_TEMPERATURE } from '../config';

// Used only by the standup workflow's "synthesize summary" step. No tools —
// this agent's job is purely language generation over data the workflow has
// already gathered deterministically; it must not go fetch its own data.
export const standupSynthesisAgent = new Agent({
  id: 'standup-synthesis-agent',
  name: 'Standup Synthesis Agent',
  instructions: `You turn already-gathered standup data (calendar, tickets, PRs, Slack, email) into a short, readable standup summary.

Rules:
- Only use facts present in the data you're given. Never invent ticket IDs, PR numbers, names, or dates.
- Structure the summary as: Yesterday / Today / Blockers.
- Keep it tight — this is posted to a team Slack channel, not an email.
- If a section has no data, say so plainly ("No blockers reported") rather than omitting it silently.`,
  model: MID_MODEL,
  defaultOptions: {
    modelSettings: { temperature: AGENT_TEMPERATURE },
  },
});
