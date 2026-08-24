import { MCPClient } from '@mastra/mcp';

// Connects to the bake-off data server (../../../agent-sdk-bakeoff-mcp-server) —
// real Jira/GitHub/Slack/Gmail/Calendar APIs for whichever developer's
// credentials are configured server-side (JIRA_EMAIL/GITHUB_TOKEN/
// SLACK_BOT_TOKEN/Google OAuth), not a fixed persona or mock dataset.
export const pulseMcp = new MCPClient({
  id: 'pulse-assistant-mcp',
  servers: {
    pulse: {
      url: new URL(process.env.PULSE_MCP_URL ?? 'http://localhost:8081/sse'),
      // Server's own instructions cover relative-date resolution.
      forwardInstructions: true,
    },
  },
});

// Fetched once at module load — MCPClient's tool objects are stable for the process lifetime.
export const pulseTools = await pulseMcp.listTools();
