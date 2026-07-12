import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { reviewDraft, reviewerVerdictSchema } from '../agents/reviewer-agent';
import { buildAgentTrace, forwardTextAndDetectApproval } from '../../trace-utils';

// Every chat turn runs through this. Standup's own approval (start_standup/
// resume_standup) never suspends this workflow — those are ordinary tool
// calls from the agent step's point of view. This workflow only suspends for
// a spontaneous write (confirm_action, gated by requireToolApproval).

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});

const usageSchema = z
  .object({
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
    totalTokens: z.number().optional(),
  })
  .optional();

const workflowInputSchema = z.object({
  messages: z.array(messageSchema),
  userId: z.string(),
  threadId: z.string(),
  now: z.string(),
});

// Shared "turn state" shape threaded through agent -> reviewer -> approval-gate:
// either a completed draft, or a pending write approval captured mid-turn.
const turnStateSchema = z.object({
  status: z.enum(['ok', 'pending_approval']),
  text: z.string().optional(),
  toolCalls: z.array(z.any()).optional(),
  toolResults: z.array(z.any()).optional(),
  usage: usageSchema,
  runId: z.string().optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  args: z.record(z.string(), z.any()).optional(),
});

const agentStep = createStep({
  id: 'run-agent',
  description: '1. Run the chat agent, streaming live tokens into the workflow stream',
  inputSchema: workflowInputSchema,
  outputSchema: turnStateSchema,
  execute: async ({ inputData, mastra, writer }) => {
    const agent = mastra!.getAgent('chatAgent');
    const memoryScope = { resource: inputData.userId, thread: inputData.threadId };

    // Without this the model guesses `now`/identity (observed: a fabricated
    // date fed into start_standup, cascading into invented content).
    const groundedMessages = [
      { role: 'system' as const, content: `Current date/time: ${inputData.now}. Current user id: ${inputData.userId}.` },
      ...inputData.messages,
    ];

    // Cast: messageSchema's shape doesn't structurally match the SDK's
    // discriminated message union, even though every element is valid.
    const current = await agent.stream(
      groundedMessages as Parameters<typeof agent.stream>[0],
      { memory: memoryScope },
    );
    const { text, approval } = await forwardTextAndDetectApproval(current, writer);

    if (approval) {
      return {
        status: 'pending_approval' as const,
        runId: current.runId,
        toolCallId: approval.toolCallId,
        toolName: approval.toolName,
        args: approval.args,
      };
    }

    return {
      status: 'ok' as const,
      text,
      toolCalls: await current.toolCalls,
      toolResults: await current.toolResults,
      usage: await current.usage,
    };
  },
});

const reviewedStateSchema = turnStateSchema.extend({
  trace: z.array(z.any()).optional(),
  reviewer: reviewerVerdictSchema.optional(),
});

const reviewerStep = createStep({
  id: 'review-draft',
  description:
    '2. Check the draft against its tool-call trace (skipped when a write is still pending approval — nothing final to check yet)',
  inputSchema: turnStateSchema,
  outputSchema: reviewedStateSchema,
  execute: async ({ inputData, getInitData }) => {
    if (inputData.status === 'pending_approval') {
      return inputData;
    }
    const { now } = getInitData() as z.infer<typeof workflowInputSchema>;
    const trace = buildAgentTrace(inputData.toolCalls, inputData.toolResults);
    const reviewer = await reviewDraft({ draft: inputData.text ?? '', trace, now });
    return { ...inputData, trace, reviewer };
  },
});

const finalStateSchema = z.object({
  text: z.string(),
  trace: z.array(z.any()),
  reviewer: reviewerVerdictSchema.optional(),
  usage: usageSchema,
});

const approvalGateStep = createStep({
  id: 'approval-gate',
  description:
    '3. Suspend for a human decision if the agent drafted a spontaneous write action; otherwise pass through',
  inputSchema: reviewedStateSchema,
  outputSchema: finalStateSchema,
  resumeSchema: z.object({ approved: z.boolean() }),
  suspendSchema: z.object({ toolName: z.string(), args: z.record(z.string(), z.any()) }),
  execute: async ({ inputData, resumeData, suspend, mastra, writer, getInitData }) => {
    if (inputData.status !== 'pending_approval') {
      return { text: inputData.text ?? '', trace: inputData.trace ?? [], reviewer: inputData.reviewer, usage: inputData.usage };
    }
    if (!resumeData) {
      return await suspend({ toolName: inputData.toolName!, args: inputData.args! });
    }

    const agent = mastra!.getAgent('chatAgent');
    let current = resumeData.approved
      ? await agent.approveToolCall({ runId: inputData.runId!, toolCallId: inputData.toolCallId })
      : await agent.declineToolCall({ runId: inputData.runId!, toolCallId: inputData.toolCallId });

    let { text, approval } = await forwardTextAndDetectApproval(current, writer);
    // A second write in the same turn can't get its own suspend/resume round
    // trip here — auto-decline rather than silently executing it unapproved.
    if (approval) {
      current = await agent.declineToolCall({ runId: current.runId, toolCallId: approval.toolCallId });
      const continued = await forwardTextAndDetectApproval(current, writer);
      text += continued.text;
    }

    const toolCalls = await current.toolCalls;
    const toolResults = await current.toolResults;
    const usage = await current.usage;
    const trace = buildAgentTrace(toolCalls, toolResults);
    const { now } = getInitData() as z.infer<typeof workflowInputSchema>;
    const reviewer = await reviewDraft({ draft: text, trace, now });

    return { text, trace, reviewer, usage };
  },
});

const finalizeStep = createStep({
  id: 'finalize',
  description: '4. Assemble the final { reply, trace } for the caller',
  inputSchema: finalStateSchema,
  outputSchema: z.object({
    reply: z.string(),
    trace: z.array(z.any()),
    reviewer: reviewerVerdictSchema.optional(),
    usage: usageSchema,
  }),
  execute: async ({ inputData }) => ({
    reply: inputData.text,
    trace: inputData.trace,
    reviewer: inputData.reviewer,
    usage: inputData.usage,
  }),
});

export const chatTurnWorkflow = createWorkflow({
  id: 'chat-turn-workflow',
  inputSchema: workflowInputSchema,
  outputSchema: finalizeStep.outputSchema,
})
  .then(agentStep)
  .then(reviewerStep)
  .then(approvalGateStep)
  .then(finalizeStep)
  .commit();
