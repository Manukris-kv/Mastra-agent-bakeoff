import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';

import { weatherAgent } from './agents/weather-agent';

export const mastra = new Mastra({
  agents: { weatherAgent },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    // In-memory storage — fine for the example agent, not for anything that
    // needs to survive a process restart (see checkpoint-2's memory).
    url: ':memory:',
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
