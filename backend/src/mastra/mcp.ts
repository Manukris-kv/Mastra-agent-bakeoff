import { MCPClient } from '@mastra/mcp';

// Connects to the bake-off mock data server (../../../agent-sdk-bakeoff-mcp-server) —
// Jira/GitHub/Slack/Gmail/Calendar for one fixed user, "Aisha Khan".
//
// Writes (update_jira_ticket/post_slack_message/send_email) only draft and
// return a pending_action_id; confirm_action(pending_action_id) is the only
// way a write executes. Gating that one tool with requireToolApproval turns
// the server's own draft/confirm protocol into our human-approval pause.
export const pulseMcp = new MCPClient({
  id: 'pulse-assistant-mcp',
  servers: {
    pulse: {
      url: new URL(process.env.PULSE_MCP_URL ?? 'http://localhost:8081/sse'),
      // Receives the server's own un-namespaced tool name, not "pulse_confirm_action".
      requireToolApproval: ({ toolName }: { toolName: string }) => toolName === 'confirm_action',
      // Server's own instructions cover the draft/confirm protocol and frozen reference date.
      forwardInstructions: true,
    },
  },
});

// Fetched once at module load — MCPClient's tool objects are stable for the process lifetime.
export const pulseTools = await pulseMcp.listTools();

// For workflow steps that call a tool directly, bypassing the agent's own
// tool-calling loop (e.g. standup-workflow.ts). Unwraps the two response
// shapes this server actually returns depending on the tool: `{ result: T }`
// vs the raw MCP `{ content: [{ type: 'text', text: '...json...' }] }` envelope.
export async function callMcpTool(toolName: string, args: Record<string, unknown> = {}): Promise<any> {
  const tool = pulseTools[`pulse_${toolName}`];
  if (!tool) {
    throw new Error(`MCP tool not found: pulse_${toolName}`);
  }
  const raw = await (tool as unknown as { execute: (input: Record<string, unknown>) => Promise<unknown> }).execute(args);
  return unwrapMcpResult(raw);
}

function unwrapMcpResult(raw: unknown): unknown {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if ('result' in obj && !('content' in obj)) {
      return obj.result;
    }
    if (Array.isArray(obj.content)) {
      const textBlock = (obj.content as Array<{ type?: string; text?: string }>).find(c => c?.type === 'text');
      if (textBlock && typeof textBlock.text === 'string') {
        try {
          return JSON.parse(textBlock.text);
        } catch {
          return textBlock.text;
        }
      }
    }
  }
  return raw;
}
