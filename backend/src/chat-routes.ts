// Thin HTTP wrapper around src/chat.ts's runChatTurn. Stateless: a suspended
// run resumes purely by its runId (Mastra's storage persists the snapshot).
// Streams each event as one NDJSON line via Hono's `stream()` helper.
import { registerApiRoute } from '@mastra/core/server';
import { stream as honoStream } from 'hono/streaming';
import { runChatTurn, type RunChatTurnInput } from './chat';

// `c: any`: Hono's Context generic is awkward to name outside its own handler.
async function streamChatTurn(c: any, input: RunChatTurnInput) {
  c.header('Content-Type', 'application/x-ndjson');
  return honoStream(c, async s => {
    for await (const event of runChatTurn(input)) {
      await s.writeln(JSON.stringify(event));
    }
  });
}

export const chatMessageRoute = registerApiRoute('/chat/message', {
  method: 'POST',
  handler: async c => {
    const body = await c.req.json();
    const userId = body.userId as string;
    const threadId = body.threadId as string;
    const message = body.message as string;

    return streamChatTurn(c, {
      conversation: [{ role: 'user', content: message }],
      taskConfig: { mode: 3, userId, now: new Date().toISOString(), threadId },
    });
  },
});

export const chatApproveRoute = registerApiRoute('/chat/approve', {
  method: 'POST',
  handler: async c => {
    const body = await c.req.json();
    const runId = body.runId as string;
    const approved = body.approved as boolean;
    const userId = body.userId as string;

    return streamChatTurn(c, {
      conversation: [],
      taskConfig: { mode: 3, userId, now: new Date().toISOString() },
      runId,
      resumeData: { approved },
    });
  },
});
