import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';

import { standupWorkflow } from './workflows/standup-workflow';
import { standupSynthesisAgent } from './agents/standup-synthesis-agent';
import { chatAgent } from './agents/chat-agent';

export const mastra = new Mastra({
  workflows: { standupWorkflow },
  agents: { standupSynthesisAgent, chatAgent },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: ':memory:',
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
