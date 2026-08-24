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
    // File-backed, not ':memory:' — a suspended workflow run (see
    // standup-workflow.ts's approve-standup step) has to survive this
    // process exiting entirely; resuming it is a separate invocation.
    url: 'file:mastra.db',
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
