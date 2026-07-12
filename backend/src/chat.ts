// The single streaming entrypoint (§13-shaped) — the one thing every caller
// (harness now, a real UI later) talks to. Internally: chatTurnWorkflow's
// run.stream()/run.resumeStream(), forwarding every chunk to the caller as it
// arrives. Since this only calls the chat agent and Workflow 2, it doesn't
// need to change when the underlying tool/data source changes (it already
// didn't, when local stub tools were swapped for the real MCP server — see
// ../src/mastra/mcp.ts).

import { toModelMessage, type ConversationMessage, type ChatChunk } from './trace-utils';
import type { ReviewerVerdict } from './mastra/agents/reviewer-agent';

export type TaskConfig = {
  // Kept for scoring only (which rubric row a finished transcript is judged
  // against) — never fed into the chat agent's behavior. There's no more
  // mode branching: the agent infers scope from the message itself.
  mode: 1 | 2 | 3;
  userId: string;
  now: string;
  threadId?: string;
};

export type RunChatTurnInput = {
  conversation: ConversationMessage[];
  taskConfig: TaskConfig;
  // Present when resuming a turn that suspended waiting on a spontaneous
  // write's approval (see chat-turn-workflow.ts's approval-gate step).
  // Standup's own approval never needs this — that's handled entirely
  // through ordinary conversation (start_standup / resume_standup tool calls).
  runId?: string;
  resumeData?: { approved: boolean };
};

export type ChatEvent =
  | ChatChunk
  | { type: 'approval_required'; runId: string; description: string; payload: unknown }
  | { type: 'finish'; reply: string; trace: unknown[]; reviewer: ReviewerVerdict | undefined; usage: unknown };

export async function* runChatTurn(input: RunChatTurnInput): AsyncGenerator<ChatEvent, void, unknown> {
  // Dynamic import rather than a top-level one: chat-routes.ts (imported by
  // src/mastra/index.ts to register its API routes) imports this file, so a
  // static top-level `import { mastra } from './mastra'` here would close a
  // circular dependency (index.ts -> chat-routes.ts -> chat.ts -> index.ts).
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
    // suspendPayload is keyed by the suspended step's id (only one step in
    // this workflow ever suspends, so just take the one value) — same
    // nesting-by-step-id convention as the standup workflow's own suspend.
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

// For non-streaming callers (e.g. a batch scorer): collect the same run's
// events into { reply, trace } — one code path serves both streaming and
// batch use rather than maintaining two.
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
