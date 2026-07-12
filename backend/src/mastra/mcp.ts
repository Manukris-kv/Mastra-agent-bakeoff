import { MCPClient } from '@mastra/mcp';

// Connects to the shared bake-off mock data server (Jira/GitHub/Slack/Gmail/
// Calendar for a single fixed developer, "Aisha Khan") — see
// ../../../agent-sdk-bakeoff-mcp-server. Replaces the local stub tools that
// used to live in src/mastra/tools/{jira,github,slack,gmail,calendar,linking,
// profile,escalate}.ts; this is exactly the swap those stubs were built for.
//
// Guardrail #2 (human approval before writes) is enforced by the server's
// OWN draft/confirm protocol, not our old requireApproval()/withApproval()
// wrapper: update_jira_ticket / post_slack_message / send_email only ever
// draft a change and return a pending_action_id — nothing happens until
// confirm_action(pending_action_id) is called. We gate that single
// confirm_action tool with requireToolApproval, which pauses the agent's
// turn exactly the way our local requireApproval-wrapped tools used to —
// the rest of chat-turn-workflow.ts's approval-gate step needed zero changes.
export const pulseMcp = new MCPClient({
  id: 'pulse-assistant-mcp',
  servers: {
    pulse: {
      url: new URL(process.env.PULSE_MCP_URL ?? 'http://localhost:8081/sse'),
      // Received as the server's own (un-namespaced) tool name, not the
      // Mastra-side "pulse_confirm_action" namespaced key — verified directly
      // against the running server before wiring this in.
      requireToolApproval: ({ toolName }: { toolName: string }) => toolName === 'confirm_action',
      // The server's own instructions explain the draft/confirm protocol and
      // that date filters resolve against its frozen reference date, not the
      // wall clock — forwarding them keeps that guidance in one place (the
      // server) instead of duplicating it by hand in chat-agent.ts.
      forwardInstructions: true,
    },
  },
});

// Fetched once at module load (not per call) — MCPClient's tool objects are
// stable for the process lifetime, and re-listing per call would add a
// round trip for no benefit.
export const pulseTools = await pulseMcp.listTools();

// For workflow steps that call a tool directly (bypassing the agent's own
// tool-calling loop) — e.g. standup-workflow.ts's deterministic steps.
// Unwraps the two response shapes actually observed from this server:
// `{ result: T }` (FastMCP's auto-generated structuredContent for tools
// whose return type is JSON-schema-representable, e.g. `list[dict]`) and
// the raw MCP `{ content: [{ type: 'text', text: '...json...' }], isError }`
// envelope (tools whose return type didn't get structuredContent, e.g. a
// bare `dict`) — confirmed by direct testing that the same server returns
// both shapes depending on the tool, not just one consistently.
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
