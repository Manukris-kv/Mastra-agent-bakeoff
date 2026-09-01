import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { PostgresStoreVNext } from '@mastra/pg';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';

import { standupWorkflow } from './workflows/standup-workflow';
import { chatTurnWorkflow } from './workflows/chat-turn-workflow';
import { standupSynthesisAgent } from './agents/standup-synthesis-agent';
import { chatAgent } from './agents/chat-agent';
import { reviewerAgent } from './agents/reviewer-agent';
import { noFabricationScorer } from './scorers/no-fabrication-scorer';
import { chatMessageRoute, chatApproveRoute } from '../chat-routes';

export const mastra = new Mastra({
  workflows: { standupWorkflow, chatTurnWorkflow },
  agents: { standupSynthesisAgent, chatAgent, reviewerAgent },
  scorers: { noFabricationScorer },
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
  // changed from PostgresStore to PostgresStoreVNext as PostgresStore does not support observability
  storage: new PostgresStoreVNext({
    id: 'mastra-storage',
    connectionString: process.env.DATABASE_URL!,
    observability: {
      connectionString: process.env.DATABASE_URL!,
    },
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(), // Persists observability events to Mastra Storage
          new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});
