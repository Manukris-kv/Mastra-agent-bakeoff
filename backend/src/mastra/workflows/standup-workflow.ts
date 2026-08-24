import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { callMcpTool } from '../mcp';

// Checkpoint 3: standup prep as a fixed, deterministic procedure — the
// workflow engine owns step order, not model reasoning. Every data-gathering
// step calls the MCP server directly via callMcpTool(), bypassing the
// agent's tool-calling loop entirely. No agent is involved in running this;
// see scripts/run-standup.ts. Schemas are loose (z.any()) rather than
// mirroring the MCP server's shapes.

const workflowInputSchema = z.object({
  userId: z.string(),
  now: z.string(),
});

// Threaded through so the caller can report cost/tokens for the one LLM step.
const usageSchema = z
  .object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
  })
  .optional();

const profileStep = createStep({
  id: 'get-profile',
  description: '1. Look up the user profile',
  inputSchema: workflowInputSchema,
  outputSchema: z.record(z.string(), z.any()),
  execute: async () => callMcpTool('get_user_profile'),
});

const calendarStep = createStep({
  id: 'get-calendar',
  description: "2. Fetch today's calendar events",
  inputSchema: profileStep.outputSchema,
  outputSchema: z.array(z.any()),
  // Resolves server-side against the real current date, not our wall-clock `now`.
  execute: async () => callMcpTool('get_calendar_events', { start_date: 'today', end_date: 'today' }),
});

const ticketsStep = createStep({
  id: 'get-tickets',
  description: '3. Fetch the Jira tickets assigned to the user',
  inputSchema: calendarStep.outputSchema,
  outputSchema: z.array(z.any()),
  execute: async ({ getStepResult }) => {
    const profile = getStepResult(profileStep) as { email: string };
    return callMcpTool('get_jira_tickets', { assignee: profile.email });
  },
});

const linkPrsStep = createStep({
  id: 'link-prs-for-ticket',
  description: '4. (loop) Resolve linked PRs for each ticket',
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
  description: '5. (loop) Fetch detail for each linked PR',
  inputSchema: z.string(),
  outputSchema: z.record(z.string(), z.any()),
  execute: async ({ inputData }) => callMcpTool('get_github_pr_detail', { pr_id: inputData }),
});

const slackStep = createStep({
  id: 'get-slack',
  description: '6. Fetch recent standup-channel Slack messages',
  inputSchema: z.array(z.any()),
  outputSchema: z.array(z.any()),
  execute: async () => callMcpTool('get_slack_messages', { channel: 'standup' }),
});

const gmailStep = createStep({
  id: 'get-gmail',
  description: '7. Fetch recent Gmail threads',
  inputSchema: z.array(z.any()),
  outputSchema: z.array(z.any()),
  execute: async () => callMcpTool('get_gmail_threads', {}),
});

const synthesizeStep = createStep({
  id: 'synthesize-summary',
  description: '8. Synthesize the standup summary (the one step needing language generation)',
  inputSchema: z.array(z.any()),
  outputSchema: z.object({ summary: z.string(), usage: usageSchema }),
  execute: async ({ mastra, getStepResult }) => {
    const profile = getStepResult(profileStep) as { name: string; role: string; team: string };
    const calendar = getStepResult(calendarStep);
    const tickets = getStepResult(ticketsStep);
    const prDetails = getStepResult(prDetailStep);
    const slack = getStepResult(slackStep);
    const gmail = getStepResult(gmailStep);

    const agent = mastra?.getAgent('standupSynthesisAgent');
    if (!agent) {
      throw new Error('standupSynthesisAgent not found');
    }

    const prompt = `Write a standup summary for ${profile.name} (${profile.role}, ${profile.team} team), covering Yesterday, Today, and Blockers.

Use "Yesterday"/"Today" as section labels rather than restating an absolute calendar date, and ground every sentence in the data below (do not invent tickets, PRs, messages, or dates that aren't present).

Calendar events today:
${JSON.stringify(calendar, null, 2)}

Assigned Jira tickets:
${JSON.stringify(tickets, null, 2)}

Linked PR detail:
${JSON.stringify(prDetails, null, 2)}

Recent Slack messages (#standup):
${JSON.stringify(slack, null, 2)}

Recent Gmail threads:
${JSON.stringify(gmail, null, 2)}

Format: a short "Yesterday / Today / Blockers" standup summary, plain text, ready to post to Slack.`;

    const result = await agent.generate(prompt);
    return { summary: result.text, usage: result.usage };
  },
});

// Checkpoint 4: the pipeline now stops and waits for a real human decision
// before doing anything irreversible, and picks back up exactly where it
// left off — even in a brand-new process, since Mastra persists the
// suspended run's state rather than holding it in memory.

const approvalStep = createStep({
  id: 'approve-standup',
  description: '9. Suspend for human approval before posting',
  inputSchema: synthesizeStep.outputSchema,
  outputSchema: z.object({ approved: z.boolean(), summary: z.string(), usage: usageSchema }),
  resumeSchema: z.object({ approved: z.boolean() }),
  suspendSchema: z.object({ summary: z.string() }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return await suspend({ summary: inputData.summary });
    }
    return { approved: resumeData.approved, summary: inputData.summary, usage: inputData.usage };
  },
});

const postStep = createStep({
  id: 'post-standup',
  description: '10. Post the approved summary to Slack',
  inputSchema: approvalStep.outputSchema,
  outputSchema: z.object({
    status: z.enum(['posted', 'declined']),
    summary: z.string(),
    channel: z.string().optional(),
    ts: z.string().optional(),
    usage: usageSchema,
  }),
  execute: async ({ inputData }) => {
    if (!inputData.approved) {
      return { status: 'declined' as const, summary: inputData.summary, usage: inputData.usage };
    }
    // Calls draft+confirm directly, bypassing requireToolApproval — the
    // human already approved via the approve-standup suspend/resume above.
    const draft = (await callMcpTool('post_slack_message', {
      channel: 'standup',
      message: inputData.summary,
    })) as { pending_action_id: string };
    const confirmed = (await callMcpTool('confirm_action', {
      pending_action_id: draft.pending_action_id,
    })) as { result?: { channel?: string; ts?: string } };
    return {
      status: 'posted' as const,
      summary: inputData.summary,
      channel: confirmed.result?.channel,
      ts: confirmed.result?.ts,
      usage: inputData.usage,
    };
  },
});

const confirmStep = createStep({
  id: 'confirm-standup',
  description: '11. Confirm the outcome',
  inputSchema: postStep.outputSchema,
  outputSchema: z.object({
    status: z.enum(['posted', 'declined']),
    summary: z.string(),
    channel: z.string().optional(),
    ts: z.string().optional(),
    usage: usageSchema,
    confirmation: z.string(),
  }),
  execute: async ({ inputData }) => ({
    ...inputData,
    confirmation:
      inputData.status === 'posted'
        ? `Standup summary posted to #${inputData.channel} at ${inputData.ts}.`
        : 'Standup summary was not approved — nothing was posted.',
  }),
});

export const standupWorkflow = createWorkflow({
  id: 'standup-workflow',
  inputSchema: workflowInputSchema,
  outputSchema: confirmStep.outputSchema,
})
  .then(profileStep)
  .then(calendarStep)
  .then(ticketsStep)
  // Sequential .foreach(), not .parallel() — keeps ordering deterministic.
  .foreach(linkPrsStep)
  .map(async ({ inputData }) => inputData.flatMap(t => t.prIds))
  .foreach(prDetailStep)
  .then(slackStep)
  .then(gmailStep)
  .then(synthesizeStep)
  .then(approvalStep)
  .then(postStep)
  .then(confirmStep)
  .commit();
