// Interactive chat API for the frontend's single chat screen — a thin HTTP
// wrapper around src/chat.ts's runChatTurn. Stateless: a suspended run is
// resumed purely by its runId (Mastra's storage persists the snapshot), so
// there's no in-memory pending-approval map to maintain here.
//
// Streams real-time: each runChatTurn event (text/reasoning/tool-call/
// tool-result/approval_required/finish) is written to the HTTP response as
// one NDJSON line as soon as it's produced, via Hono's `stream()` helper —
// the frontend reads the response body incrementally rather than waiting
// for one buffered JSON blob.
import { registerApiRoute } from '@mastra/core/server';
import { stream as honoStream } from 'hono/streaming';
import { runChatTurn, type RunChatTurnInput } from './chat';

// `c: any` here is a pragmatic pass-through: Hono's Context type carries a
// route-path-specific generic that's awkward to name outside the handler
// that receives it, and honoStream()'s own signature still checks the value.
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
      // mode is scoring-only metadata per the shared harness contract — it
      // has no effect on chat behavior, so the demo UI doesn't collect it.
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
