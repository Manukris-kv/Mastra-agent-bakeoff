import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

// One shared Memory instance for every agent, scoped per-call by
// `{ resource: userId, thread: conversationId }` (see agent.generate calls in
// src/adapter.ts). This is what lets Mode 3's multi-turn clarification and
// follow-ups retain context across turns.
export const sharedMemory = new Memory({
  storage: new LibSQLStore({
    id: 'agent-memory-storage',
    url: 'file:./mastra-memory.db',
  }),
  options: {
    lastMessages: 40,
    workingMemory: {
      enabled: true,
    },
  },
});
