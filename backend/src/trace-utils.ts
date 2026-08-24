// Pure helpers shared across the chat pipeline — kept free of the `mastra`
// singleton import to avoid a circular dependency through src/mastra/index.ts.

export type ConversationMessage = { role: string; content: string };

export type TraceEntry = {
  tool: string;
  args: unknown;
  result: unknown;
  timestamp: string;
};

export type PendingToolApproval = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

// Live, incremental pieces of a turn forwarded to the UI as they happen.
export type ChatChunk =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown; isError?: boolean };

export function toModelMessage(m: ConversationMessage) {
  if (m.role === 'assistant') return { role: 'assistant' as const, content: m.content };
  if (m.role === 'system') return { role: 'system' as const, content: m.content };
  return { role: 'user' as const, content: m.content };
}

export function buildAgentTrace(toolCalls: unknown, toolResults: unknown): TraceEntry[] {
  const now = new Date().toISOString();
  const calls = (toolCalls ?? []) as Array<{ payload: { toolCallId?: string; toolName: string; args?: unknown } }>;
  const results = (toolResults ?? []) as Array<{ payload: { toolCallId?: string; result: unknown } }>;
  return calls.map(call => {
    const match = results.find(r => r.payload.toolCallId === call.payload.toolCallId);
    return {
      tool: call.payload.toolName,
      args: call.payload.args,
      result: match?.payload.result,
      timestamp: now,
    };
  });
}

// Iterates an agent stream's fullStream, forwarding chunks into the workflow
// step's `writer` (live nested streaming), and watches for a
// `tool-call-approval` chunk (a `requireToolApproval`-gated tool call) so the
// caller can suspend for a human decision.
//
// Accumulates text from text-delta chunks itself rather than trusting the
// stream's own `.text` promise — across a multi-tool-call turn, `.text` came
// back empty here even though the deltas themselves were correct.
export async function forwardTextAndDetectApproval(
  stream: { fullStream: AsyncIterable<{ type: string; payload?: unknown }> },
  writer: { write: (chunk: unknown) => Promise<void> },
): Promise<{ text: string; approval?: PendingToolApproval }> {
  let text = '';
  let approval: PendingToolApproval | undefined;
  for await (const chunk of stream.fullStream) {
    if (chunk.type === 'text-delta') {
      const delta = (chunk.payload as { text?: string } | undefined)?.text;
      if (delta) {
        text += delta;
        await writer.write({ type: 'text', text: delta } satisfies ChatChunk);
      }
    } else if (chunk.type === 'reasoning-delta') {
      const delta = (chunk.payload as { text?: string } | undefined)?.text;
      if (delta) {
        await writer.write({ type: 'reasoning', text: delta } satisfies ChatChunk);
      }
    } else if (chunk.type === 'tool-call') {
      const payload = chunk.payload as { toolCallId: string; toolName: string; args?: unknown };
      await writer.write({
        type: 'tool-call',
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        args: payload.args,
      } satisfies ChatChunk);
    } else if (chunk.type === 'tool-result') {
      const payload = chunk.payload as { toolCallId: string; toolName: string; result: unknown; isError?: boolean };
      await writer.write({
        type: 'tool-result',
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        result: payload.result,
        isError: payload.isError,
      } satisfies ChatChunk);
    } else if (chunk.type === 'tool-call-approval') {
      approval = chunk.payload as PendingToolApproval;
    }
  }
  return { text, approval };
}
