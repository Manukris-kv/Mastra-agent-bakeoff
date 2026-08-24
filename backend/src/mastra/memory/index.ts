import { Memory } from '@mastra/memory';
import { PostgresStore } from '@mastra/pg';

// One shared Memory instance for every agent, scoped per-call by { resource: userId, thread: threadId }.
export const sharedMemory = new Memory({
  storage: new PostgresStore({
    id: 'agent-memory-storage',
    connectionString: process.env.DATABASE_URL!,
  }),
  options: {
    lastMessages: 20,
    workingMemory: {
      enabled: true,
    },
  },
});
