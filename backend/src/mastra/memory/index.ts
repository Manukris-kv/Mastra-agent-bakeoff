import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

// One shared Memory instance for every agent, scoped per-call by { resource: userId, thread: threadId }.
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
