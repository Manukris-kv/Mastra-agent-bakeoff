// Interactive smoke test for src/chat.ts's runChatTurn.
//
// One-shot:    npx tsx scripts/test-flows.ts "your message here"
// Interactive: npx tsx scripts/test-flows.ts
//
// TEST_USER_ID=whatever scopes our own memory only — the real MCP-backed user is fixed.

import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { runChatTurn, type RunChatTurnInput } from '../src/chat';

// Load backend/.env so this runs standalone — fine if it's already loaded
// another way (e.g. exported in the shell), just skip a missing file.
try {
  process.loadEnvFile();
} catch (err) {
  if (!(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT')) throw err;
}

const userId = process.env.TEST_USER_ID || 'demo-user';
const threadId = randomUUID();

type TurnResult = {
  reply?: string;
  reviewer?: unknown;
  pendingApproval?: { runId: string; description: string; payload: unknown };
};

// Bare ANSI codes rather than a dependency — this is a dev-only script.
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

const MAX_JSON_LEN = 1200;

// Some MCP tool results wrap the payload as {content: [{type: 'text', text: '...json...'}]}
// rather than returning it directly — unwrap for display (see ../src/mastra/mcp.ts).
function unwrapForDisplay(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.content) && obj.content.length === 1) {
      const block = obj.content[0] as { type?: string; text?: string };
      if (block?.type === 'text' && typeof block.text === 'string') {
        try {
          return JSON.parse(block.text);
        } catch {
          return block.text;
        }
      }
    }
  }
  return value;
}

// Pretty-prints a value as indented JSON, dimmed and re-indented under a
// left margin, truncating long blobs (tool results can be huge) instead of
// flooding the terminal with a single unreadable line.
function prettyJson(value: unknown, indent = '     '): string {
  let text: string;
  try {
    text = JSON.stringify(unwrapForDisplay(value), null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  if (text.length > MAX_JSON_LEN) {
    text = `${text.slice(0, MAX_JSON_LEN)}\n… (truncated, ${text.length} chars total)`;
  }
  return text
    .split('\n')
    .map(line => `${indent}${c.dim}${line}${c.reset}`)
    .join('\n');
}

async function streamTurn(input: RunChatTurnInput): Promise<TurnResult> {
  const result: TurnResult = {};
  let inToolBlock = false;
  let inReasoningBlock = false;
  let printedLabel = false;

  function closeReasoningBlock() {
    if (inReasoningBlock) {
      inReasoningBlock = false;
      process.stdout.write(`${c.reset}\n`);
    }
  }

  for await (const event of runChatTurn(input)) {
    switch (event.type) {
      case 'text':
        closeReasoningBlock();
        if (!printedLabel) {
          printedLabel = true;
          process.stdout.write(`${c.bold}${c.cyan}Assistant:${c.reset} `);
        }
        if (inToolBlock) {
          inToolBlock = false;
          process.stdout.write('\n');
        }
        process.stdout.write(`${c.reset}${event.text}`);
        break;
      case 'reasoning':
        if (!inReasoningBlock) {
          inReasoningBlock = true;
          process.stdout.write(`\n${c.gray}${c.bold}🤔 Thinking${c.reset}\n${c.dim}`);
        }
        process.stdout.write(`${c.dim}${event.text}${c.reset}`);
        break;
      case 'tool-call':
        closeReasoningBlock();
        inToolBlock = true;
        process.stdout.write(
          `\n${c.yellow}${c.bold}  🔧 ${event.toolName}${c.reset}${c.yellow}(${c.reset}\n${prettyJson(event.args)}\n${c.yellow}  )${c.reset}\n`,
        );
        break;
      case 'tool-result': {
        const label = event.isError ? `${c.red}✗ error${c.reset}` : `${c.green}↳ result${c.reset}`;
        process.stdout.write(`  ${label}\n${prettyJson(event.result)}\n`);
        break;
      }
      case 'approval_required':
        closeReasoningBlock();
        inToolBlock = false;
        result.pendingApproval = event;
        process.stdout.write(
          `\n${c.red}${c.bold}┌─ approval required ${'─'.repeat(40)}${c.reset}\n` +
            `${c.red}│${c.reset} ${event.description}\n` +
            `${prettyJson(event.payload, `${c.red}│${c.reset}    `)}\n` +
            `${c.red}${c.bold}└${'─'.repeat(62)}${c.reset}\n`,
        );
        break;
      case 'finish':
        closeReasoningBlock();
        result.reply = event.reply;
        result.reviewer = event.reviewer;
        process.stdout.write('\n');
        printReviewer(event.reviewer);
        printUsage(event.usage);
        break;
    }
  }
  return result;
}

function printReviewer(reviewer: unknown): void {
  if (!reviewer || typeof reviewer !== 'object') return;
  const r = reviewer as { approved?: boolean; issues?: string[]; correctionRequest?: string };
  if (r.approved) {
    console.log(`${c.green}✓ reviewer: approved${c.reset}`);
    return;
  }
  console.log(`${c.yellow}${c.bold}⚠ reviewer: flagged issues${c.reset}`);
  for (const issue of r.issues ?? []) {
    console.log(`${c.yellow}  • ${issue}${c.reset}`);
  }
  if (r.correctionRequest) {
    console.log(`${c.gray}  correction requested: ${r.correctionRequest}${c.reset}`);
  }
}

function printUsage(usage: unknown): void {
  if (!usage || typeof usage !== 'object') return;
  const u = usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  if (u.inputTokens === undefined && u.outputTokens === undefined && u.totalTokens === undefined) return;
  console.log(
    `${c.gray}  tokens: ${u.inputTokens ?? '?'} in / ${u.outputTokens ?? '?'} out / ${u.totalTokens ?? '?'} total${c.reset}`,
  );
}

async function turn(message: string): Promise<TurnResult> {
  return streamTurn({
    conversation: [{ role: 'user', content: message }],
    taskConfig: { mode: 3, userId, now: new Date().toISOString(), threadId },
  });
}

async function resumeTurn(runId: string, approved: boolean): Promise<TurnResult> {
  return streamTurn({
    conversation: [],
    taskConfig: { mode: 3, userId, now: new Date().toISOString() },
    runId,
    resumeData: { approved },
  });
}

// If a turn suspends on a spontaneous write, ask for a real approve/deny
// right here rather than auto-approving — this is meant for poking at the
// approval flow interactively, not just batch-confirming everything.
async function handlePendingApproval(rl: ReturnType<typeof createInterface>, result: TurnResult) {
  while (result.pendingApproval) {
    const answer = (await rl.question(`Approve "${result.pendingApproval.description}"? (y/n) `)).trim().toLowerCase();
    const approved = answer.startsWith('y');
    result = await resumeTurn(result.pendingApproval.runId, approved);
  }
}

async function main() {
  const argMessage = process.argv.slice(2).join(' ').trim();
  const rl = createInterface({ input: stdin, output: stdout });

  if (argMessage) {
    const result = await turn(argMessage);
    await handlePendingApproval(rl, result);
    rl.close();
    return;
  }

  console.log(`Chatting as ${userId} (thread ${threadId}). Type a message, or "exit" to quit.\n`);
  for (;;) {
    let message: string;
    try {
      message = (await rl.question('> ')).trim();
    } catch (err) {
      // Piped/non-TTY stdin can hit EOF and close the interface between
      // questions (never happens with a real interactive terminal) — treat
      // that the same as the user typing "exit" instead of a crash.
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ERR_USE_AFTER_CLOSE') break;
      throw err;
    }
    if (!message || ['exit', 'quit'].includes(message.toLowerCase())) break;
    const result = await turn(message);
    await handlePendingApproval(rl, result);
  }
  rl.close();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
