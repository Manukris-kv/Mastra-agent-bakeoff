import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { callMcpTool } from '../mcp';

// Exposed to the chat agent as a tool (see chat-agent.ts's `workflows:`).
// Deterministically gathers the sprint-prep bundle (calendar -> sprint
// tickets -> PR status -> Slack -> email) so the agent doesn't improvise a
// data-gathering plan; prioritization judgment is still left to the agent.

const inputSchema = z.object({ now: z.string() });

const CURRENT_SPRINT = process.env.JIRA_CURRENT_SPRINT;

const findSprintEventStep = createStep({
  id: 'find-sprint-event',
  inputSchema,
  outputSchema: z.array(z.any()),
  // 'this_week' resolves server-side against the real current date.
  execute: async () => callMcpTool('get_calendar_events', { start_date: 'this_week', end_date: 'this_week', event_type: 'sprint_planning' }),
});

const sprintTicketsStep = createStep({
  id: 'get-sprint-tickets',
  inputSchema: findSprintEventStep.outputSchema,
  outputSchema: z.array(z.any()),
  execute: async () => callMcpTool('get_jira_tickets', CURRENT_SPRINT ? { sprint: CURRENT_SPRINT } : {}),
});

const linkPrsStep = createStep({
  id: 'link-prs-for-ticket',
  inputSchema: z.any(),
  outputSchema: z.object({ ticketId: z.string(), prIds: z.array(z.string()) }),
  execute: async ({ inputData }) => {
    const ticket = inputData as { id: string };
    const result = (await callMcpTool('link_jira_to_github', { ticket_id: ticket.id })) as {
      ticket_id: string;
      linked_prs: Array<{ id: string }>;
    };
    return { ticketId: result.ticket_id, prIds: result.linked_prs.map(pr => pr.id) };
  },
});

const prDetailStep = createStep({
  id: 'get-pr-detail',
  inputSchema: z.string(),
  outputSchema: z.record(z.string(), z.any()),
  execute: async ({ inputData }) => callMcpTool('get_github_pr_detail', { pr_id: inputData }),
});

const slackStep = createStep({
  id: 'get-slack',
  inputSchema: z.array(z.any()),
  outputSchema: z.array(z.any()),
  execute: async () => callMcpTool('get_slack_messages', { channel: 'engineering' }),
});

const gmailStep = createStep({
  id: 'get-gmail',
  inputSchema: z.array(z.any()),
  outputSchema: z.array(z.any()),
  execute: async () => callMcpTool('get_gmail_threads', { subject_contains: 'sprint' }),
});

const bundleStep = createStep({
  id: 'assemble-bundle',
  inputSchema: z.array(z.any()),
  outputSchema: z.object({
    calendarEvents: z.array(z.any()),
    sprintTickets: z.array(z.any()),
    prDetails: z.array(z.any()),
    slackMessages: z.array(z.any()),
    gmailThreads: z.array(z.any()),
  }),
  execute: async ({ getStepResult }) => ({
    calendarEvents: getStepResult(findSprintEventStep),
    sprintTickets: getStepResult(sprintTicketsStep),
    // getStepResult infers prDetailStep's own (single-item) outputSchema; at
    // runtime, inside `.foreach()`, it actually resolves to an array.
    prDetails: getStepResult(prDetailStep) as unknown as Record<string, unknown>[],
    slackMessages: getStepResult(slackStep),
    gmailThreads: getStepResult(gmailStep),
  }),
});

export const sprintPrepWorkflow = createWorkflow({
  id: 'sprint-prep-workflow',
  inputSchema,
  description: `Deterministically gathers the sprint-prep bundle (calendar -> sprint tickets -> PR status -> Slack -> email) so the agent doesn't improvise a data-gathering plan; prioritization judgment is still left to the agent.`,
  outputSchema: bundleStep.outputSchema,
})
  .then(findSprintEventStep)
  .then(sprintTicketsStep)
  .foreach(linkPrsStep)
  .map(async ({ inputData }) => inputData.flatMap(t => t.prIds))
  .foreach(prDetailStep)
  .then(slackStep)
  .then(gmailStep)
  .then(bundleStep)
  .commit();
