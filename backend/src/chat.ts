// Single streaming entrypoint for the terminal test script — wraps
// chatTurnWorkflow's run.stream()/resumeStream(), forwarding chunks live.

import { toModelMessage, type ConversationMessage, type ChatChunk } from './trace-utils';
import type { ReviewerVerdict } from './mastra/agents/reviewer-agent';

export type TaskConfig = {
  // Scoring metadata only — never fed into the agent's behavior.
  mode: 1 | 2 | 3;
  userId: string;
  now: string;
  threadId?: string;
};

export type RunChatTurnInput = {
  conversation: ConversationMessage[];
  taskConfig: TaskConfig;
  // Present when resuming a turn suspended on a spontaneous write's approval
  // (see chat-turn-workflow.ts). Standup's own approval never needs this.
  runId?: string;
  resumeData?: { approved: boolean };
};

export type ChatEvent =
  | ChatChunk
  | { type: 'approval_required'; runId: string; description: string; payload: unknown }
  | { type: 'finish'; reply: string; trace: unknown[]; reviewer: ReviewerVerdict | undefined; usage: unknown };

export async function* runChatTurn(input: RunChatTurnInput): AsyncGenerator<ChatEvent, void, unknown> {
  // Dynamic import, not static: a static import would evaluate mastra/index.ts
  // (and its env-dependent PostgresStore/LiteLLM client construction) before
  // a caller's own env-loading (e.g. test-flows.ts's process.loadEnvFile())
  // ever runs.
  const { mastra } = await import('./mastra');
  const workflow = mastra.getWorkflow('chatTurnWorkflow');
  const threadId = input.taskConfig.threadId ?? input.taskConfig.userId;

  const resuming = Boolean(input.runId && input.resumeData);
  const run = resuming ? await workflow.createRun({ runId: input.runId }) : await workflow.createRun();

  const stream = resuming
    ? await run.resumeStream({ resumeData: input.resumeData! })
    : run.stream({
        inputData: {
          messages: input.conversation.map(toModelMessage),
          userId: input.taskConfig.userId,
          threadId,
          now: input.taskConfig.now,
        },
      });

  for await (const chunk of stream.fullStream) {
    if (chunk.type === 'workflow-step-output') {
      const custom = (chunk as unknown as { payload?: { output?: ChatChunk } }).payload?.output;
      if (custom?.type === 'text' || custom?.type === 'reasoning' || custom?.type === 'tool-call' || custom?.type === 'tool-result') {
        yield custom;
      }
    }
  }

  const result = await stream.result;

  if (result.status === 'suspended') {
    // suspendPayload is keyed by the suspended step's id; only one step ever suspends.
    const suspendPayloadByStep = result.suspendPayload as Record<string, { toolName: string; args: unknown }>;
    const suspendPayload = Object.values(suspendPayloadByStep)[0];
    yield {
      type: 'approval_required',
      runId: run.runId,
      description: `Approve tool call: ${suspendPayload.toolName}`,
      payload: suspendPayload,
    };
    return;
  }

  if (result.status === 'success') {
    yield {
      type: 'finish',
      reply: result.result.reply,
      trace: result.result.trace,
      reviewer: result.result.reviewer,
      usage: result.result.usage,
    };
    return;
  }

  yield {
    type: 'finish',
    reply: `Chat turn did not complete (status: ${result.status}).`,
    trace: [],
    reviewer: undefined,
    usage: undefined,
  };
}

export type RunChatTurnBatchResult = {
  reply: string;
  trace: unknown[];
  reviewer: ReviewerVerdict | undefined;
  usage: unknown;
  pendingApproval?: { runId: string; description: string; payload: unknown };
};

// For non-streaming callers: collect the same run's events into { reply, trace }.
export async function runChatTurnBatch(input: RunChatTurnInput): Promise<RunChatTurnBatchResult> {
  let text = '';
  for await (const event of runChatTurn(input)) {
    if (event.type === 'text') {
      text += event.text;
    } else if (event.type === 'approval_required') {
      return { reply: text, trace: [], reviewer: undefined, usage: undefined, pendingApproval: event };
    } else if (event.type === 'finish') {
      return { reply: event.reply, trace: event.trace, reviewer: event.reviewer, usage: event.usage };
    }
  }
  return { reply: text, trace: [], reviewer: undefined, usage: undefined };
}
