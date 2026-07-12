import './style.css';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true });

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }));
}

// Backend is the Mastra dev server (src/chat-routes.ts registers /chat/message
// and /chat/approve as custom routes on it) — adjust if it's running elsewhere.
const BACKEND_URL = 'http://localhost:4111';

// Just our own conversation/memory identity — the backing data server is
// single-user (Aisha Khan, via get_user_profile), unrelated to this id.
const USER_ID = 'demo-user';

// One chat surface, no mode tabs: the agent infers from the message itself
// whether it's a quick lookup, open-ended planning, or a standup request —
// same as the backend (see chat-agent.ts). Standup's own approval is just
// ordinary conversation (the agent asks "shall I post it?", you type "yes"),
// so the only thing that ever produces an inline approve/deny card here is a
// spontaneous write (Slack post / Jira update / email) the agent proposes
// mid-conversation, which is a real workflow suspension server-side.

type ToolCallBlock = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
};

type ChatMessage =
  | { kind: 'user'; text: string }
  | {
      kind: 'agent';
      reasoning: string;
      toolCalls: ToolCallBlock[];
      text: string;
      done: boolean;
      reviewer?: { approved: boolean; issues: string[] };
    }
  | { kind: 'approval'; runId: string; description: string; payload: unknown; resolution?: 'approved' | 'denied' }
  | { kind: 'status'; text: string };

const threadId = crypto.randomUUID();
const messages: ChatMessage[] = [];
let busy = false;

// Reads the NDJSON response body incrementally, calling onEvent as each
// complete line arrives — this is what makes the UI feel live instead of
// waiting for one buffered JSON blob at the end.
async function streamChat(path: string, body: unknown, onEvent: (event: any) => void): Promise<void> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer.trim()));
}

function newAgentMessage(): Extract<ChatMessage, { kind: 'agent' }> {
  const msg = { kind: 'agent' as const, reasoning: '', toolCalls: [], text: '', done: false };
  messages.push(msg);
  return msg;
}

// Applies one streamed event to the in-progress agent message, mutating it
// in place; returns true once a terminal event (approval/finish) is seen.
function applyEvent(agentMsg: Extract<ChatMessage, { kind: 'agent' }>, event: any): boolean {
  switch (event.type) {
    case 'text':
      agentMsg.text += event.text;
      return false;
    case 'reasoning':
      agentMsg.reasoning += event.text;
      return false;
    case 'tool-call':
      agentMsg.toolCalls.push({ toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
      return false;
    case 'tool-result': {
      const call = agentMsg.toolCalls.find(c => c.toolCallId === event.toolCallId);
      if (call) {
        call.result = event.result;
        call.isError = event.isError;
      }
      return false;
    }
    case 'approval_required':
      agentMsg.done = true;
      messages.push({ kind: 'approval', runId: event.runId, description: event.description, payload: event.payload });
      return true;
    case 'finish':
      agentMsg.done = true;
      agentMsg.text = event.reply;
      agentMsg.reviewer = event.reviewer;
      return true;
    default:
      return false;
  }
}

async function sendMessage(text: string) {
  messages.push({ kind: 'user', text });
  const agentMsg = newAgentMessage();
  busy = true;
  render();
  try {
    await streamChat('/chat/message', { userId: USER_ID, threadId, message: text }, event => {
      applyEvent(agentMsg, event);
      render();
    });
  } catch (err) {
    messages.push({ kind: 'status', text: `Error: ${err instanceof Error ? err.message : String(err)}` });
  } finally {
    agentMsg.done = true;
    busy = false;
    render();
  }
}

async function respondApproval(msg: Extract<ChatMessage, { kind: 'approval' }>, approved: boolean) {
  msg.resolution = approved ? 'approved' : 'denied';
  const agentMsg = newAgentMessage();
  busy = true;
  render();
  try {
    await streamChat('/chat/approve', { runId: msg.runId, approved, userId: USER_ID }, event => {
      applyEvent(agentMsg, event);
      render();
    });
  } catch (err) {
    messages.push({ kind: 'status', text: `Error: ${err instanceof Error ? err.message : String(err)}` });
  } finally {
    agentMsg.done = true;
    busy = false;
    render();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    node.append(child);
  }
  return node;
}

function renderToolCall(call: ToolCallBlock): HTMLElement {
  const details = el('details', { className: 'tool-call' });
  const label = call.result === undefined ? `${call.toolName}(…)` : call.isError ? `${call.toolName} — error` : `${call.toolName}`;
  details.append(
    el('summary', {}, [`🔧 ${label}`]),
    el('pre', {}, [`args: ${JSON.stringify(call.args, null, 2)}`]),
    ...(call.result !== undefined ? [el('pre', {}, [`result: ${JSON.stringify(call.result, null, 2)}`])] : []),
  );
  return details;
}

function renderAgentMessage(msg: Extract<ChatMessage, { kind: 'agent' }>): HTMLElement {
  const blocks: Node[] = [];

  if (msg.reasoning) {
    const details = el('details', { className: 'reasoning-block' }, [
      el('summary', {}, ['🤔 Thinking']),
      el('div', { className: 'reasoning-text' }, [msg.reasoning]),
    ]);
    blocks.push(details);
  }

  for (const call of msg.toolCalls) {
    blocks.push(renderToolCall(call));
  }

  if (msg.text || msg.done) {
    const bubble = el('div', { className: 'bubble markdown', innerHTML: renderMarkdown(msg.text) });
    if (msg.reviewer && !msg.reviewer.approved) {
      blocks.push(
        el('div', { className: 'bubble-wrap' }, [
          bubble,
          el('div', { className: 'reviewer-flag' }, [
            `⚠ reviewer flagged: ${msg.reviewer.issues.join('; ') || 'unspecified issue'}`,
          ]),
        ]),
      );
    } else {
      blocks.push(bubble);
    }
  } else if (!msg.reasoning && msg.toolCalls.length === 0) {
    blocks.push(el('div', { className: 'status-line' }, ['…']));
  }

  return el('div', { className: 'bubble-row agent agent-turn' }, blocks);
}

function renderMessage(msg: ChatMessage): HTMLElement {
  if (msg.kind === 'status') {
    return el('div', { className: 'status-line' }, [msg.text]);
  }

  if (msg.kind === 'approval') {
    const card = el('div', { className: 'approval-card' }, [
      el('div', { className: 'desc' }, [msg.description]),
      el('pre', {}, [JSON.stringify(msg.payload, null, 2)]),
    ]);
    if (msg.resolution) {
      card.append(el('div', { className: 'status-line' }, [
        msg.resolution === 'approved' ? '✓ Approved' : '✗ Denied',
      ]));
    } else {
      const approveBtn = el('button', { className: 'btn approve' }, ['Approve']);
      const denyBtn = el('button', { className: 'btn deny' }, ['Deny']);
      approveBtn.onclick = () => respondApproval(msg, true);
      denyBtn.onclick = () => respondApproval(msg, false);
      card.append(el('div', { className: 'approval-actions' }, [approveBtn, denyBtn]));
    }
    return el('div', { className: 'bubble-row agent' }, [card]);
  }

  if (msg.kind === 'agent') {
    return renderAgentMessage(msg);
  }

  return el('div', { className: 'bubble-row user' }, [el('div', { className: 'bubble' }, [msg.text])]);
}

function render() {
  const app = document.getElementById('app')!;
  app.innerHTML = '';

  const header = el('div', { className: 'header' }, [
    el('h1', {}, ['Dev Daily Assistant']),
    el('p', { className: 'subtitle' }, [
      'Standup prep, quick lookups, and open-ended planning — just ask.',
    ]),
  ]);

  const messagesEl = el('div', { className: 'messages' });
  if (messages.length === 0) {
    messagesEl.append(
      el('div', { className: 'empty-state' }, [
        'Try: "Can you prep my standup?", "Any PRs waiting for my review?", or "Prep me for 2pm sprint planning."',
      ]),
    );
  }
  for (const msg of messages) {
    messagesEl.append(renderMessage(msg));
  }

  const textarea = el('textarea', {
    placeholder: 'Message the assistant…',
    disabled: busy,
  });
  const sendBtn = el('button', { className: 'btn send', disabled: busy }, ['Send']);
  const submit = () => {
    const text = textarea.value.trim();
    if (!text || busy) return;
    textarea.value = '';
    sendMessage(text);
  };
  sendBtn.onclick = submit;
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  app.append(header, messagesEl, el('div', { className: 'composer' }, [textarea, sendBtn]));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

render();
