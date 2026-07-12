import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Exposes the standup workflow to the chat agent as a start/resume tool pair —
// the agent just sees two tool calls, never a nested workflow suspension.

const outputSchema = z.object({
  status: z.enum(['pending_approval', 'posted', 'declined']),
  runId: z.string().optional().describe('Present when status is pending_approval — pass this to resume_standup'),
  summary: z.string().optional().describe('The drafted standup summary, present when status is pending_approval'),
  confirmation: z.string().optional().describe('Present once the workflow has actually finished (posted or declined)'),
});

export const startStandupTool = createTool({
  id: 'start_standup',
  description:
    "Start the fixed standup-prep procedure: gathers the user's calendar, Jira tickets, linked PRs, Slack, and email, then drafts a standup summary. Call this when the user asks for standup prep, a daily summary, or similar — not for one-off questions. This always returns status: 'pending_approval' with the drafted summary; relay it to the user and ask for a plain yes/no before calling resume_standup.",
  inputSchema: z.object({ userId: z.string(), now: z.string() }),
  outputSchema,
  execute: async (inputData, { mastra }) => {
    const workflow = mastra!.getWorkflow('standupWorkflow');
    const run = await workflow.createRun();
    const result = await run.start({ inputData: { userId: inputData.userId, now: inputData.now } });

    if (result.status === 'suspended') {
      // suspendPayload is keyed by the suspended step's id, not the payload directly.
      const suspendPayloadByStep = result.suspendPayload as Record<string, { summary: string }>;
      const suspendPayload = Object.values(suspendPayloadByStep)[0];
      return { status: 'pending_approval' as const, runId: run.runId, summary: suspendPayload.summary };
    }
    if (result.status === 'success') {
      return { status: result.result.status, confirmation: result.result.confirmation };
    }
    return { status: 'declined' as const, confirmation: `Standup workflow did not complete (status: ${result.status}).` };
  },
});

export const resumeStandupTool = createTool({
  id: 'resume_standup',
  description:
    "Resume a standup-prep run that's waiting on human approval (status: pending_approval from start_standup), after the user has given a plain yes/no to posting the drafted summary.",
  inputSchema: z.object({
    runId: z.string().describe('The runId returned by start_standup'),
    approved: z.boolean().describe('true if the user said yes to posting, false otherwise'),
  }),
  outputSchema,
  execute: async (inputData, { mastra }) => {
    const workflow = mastra!.getWorkflow('standupWorkflow');
    const run = await workflow.createRun({ runId: inputData.runId });
    const result = await run.resume({ resumeData: { approved: inputData.approved } });

    if (result.status === 'success') {
      return { status: result.result.status, confirmation: result.result.confirmation };
    }
    return { status: 'declined' as const, confirmation: `Standup workflow did not complete (status: ${result.status}).` };
  },
});
