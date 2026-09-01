import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { PostgresStore } from '@mastra/pg';

import { chatAgent } from './agents/chat-agent';

export const mastra = new Mastra({
  agents: { chatAgent },
  storage: new PostgresStore({
    id: 'mastra-storage',
    connectionString: process.env.DATABASE_URL!,
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
