// Checkpoint 2: same agent, now scoped by { resource: userId, thread: threadId }
// so it remembers who it's talking to and what's already been said.
//
// Usage: npx tsx scripts/ask.ts <userId> <threadId> "<message>"
//
// Demo (retained facts survive into a brand-new thread, same person):
//   npx tsx scripts/ask.ts alice thread-1 "Hi, remember that my username is alice123"
//   npx tsx scripts/ask.ts alice thread-1 "What's my username?"   # same conversation
//   npx tsx scripts/ask.ts alice thread-2 "What's my username?"   # brand new conversation, same person — still knows

import { mastra } from '../src/mastra';

const [userId, threadId, ...rest] = process.argv.slice(2);
const message = rest.join(' ');
if (!userId || !threadId || !message) {
  console.error('Usage: npx tsx scripts/ask.ts <userId> <threadId> "<message>"');
  process.exit(1);
}

const chatAgent = mastra.getAgent('chatAgent');
const result = await chatAgent.generate(message, {
  memory: { resource: userId, thread: threadId },
});

console.log(result.text);
console.log('\ntool calls:', JSON.stringify(result.toolCalls, null, 2));
