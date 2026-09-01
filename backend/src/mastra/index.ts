import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';

import { standupWorkflow } from './workflows/standup-workflow';
import { chatTurnWorkflow } from './workflows/chat-turn-workflow';
import { standupSynthesisAgent } from './agents/standup-synthesis-agent';
import { chatAgent } from './agents/chat-agent';
import { reviewerAgent } from './agents/reviewer-agent';
import { chatMessageRoute, chatApproveRoute } from '../chat-routes';
import { PostgresStore } from '@mastra/pg';

export const mastra = new Mastra({
  workflows: { standupWorkflow, chatTurnWorkflow },
  agents: { standupSynthesisAgent, chatAgent, reviewerAgent },
  server: {
    // Dev-only: the frontend (Vite on a different port) calls this server
    // directly. Tighten `origin` before this goes anywhere near production.
    cors: {
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    },
    apiRoutes: [chatMessageRoute, chatApproveRoute],
  },
  storage: new PostgresStore({
    id: 'mastra-storage',
    connectionString: process.env.DATABASE_URL!,
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
