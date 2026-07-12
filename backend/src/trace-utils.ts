// Pure helpers shared across the chat pipeline (src/chat.ts, chat-turn-workflow
// step files) — kept dependency-free of the `mastra` singleton itself so
// nothing importing these creates a circular import through
// src/mastra/index.ts.

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

// Live, incremental pieces of a turn forwarded to the UI as they happen —
// distinct from the final assembled { reply, trace } so the frontend can
// render reasoning and tool calls as their own blocks instead of folding
// everything into one text bubble.
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

// Iterates an agent.stream()/approveToolCall()/declineToolCall() result's
// fullStream, forwarding text, reasoning (Claude extended-thinking, when
// enabled — see chat-agent.ts), and tool-call/tool-result chunks into the
// workflow step's `writer` (live nested streaming) as distinct chunk types,
// so the UI can render them as separate blocks instead of one text bubble.
// Also watches for a `tool-call-approval` chunk — emitted when the model
// tries to call a tool with `requireApproval: true` (the write tools).
// Returns the concatenated text and, if one was seen, the approval chunk's
// payload so the caller can suspend for a human decision.
//
// Accumulates text itself from the text-delta chunks rather than trusting
// the stream's own `.text` promise: across a multi-tool-call turn (e.g. a
// data tool followed by Mastra's built-in working-memory tool) `.text`
// reliably came back empty here even though the text-delta chunks
// themselves were correct — this sidesteps whatever that aggregation quirk is.
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
