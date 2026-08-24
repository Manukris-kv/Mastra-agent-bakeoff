// Checkpoint 1's "five-line script" — send the chat agent one message and
// print the reply, including which tools it called along the way.
//
// Usage: npx tsx scripts/ask.ts "What's on my calendar today?"

import { mastra } from '../src/mastra';

const message = process.argv.slice(2).join(' ') || "What's on my calendar today?";
const chatAgent = mastra.getAgent('chatAgent');
const result = await chatAgent.generate(message);

console.log(result.text);
console.log('\ntool calls:', JSON.stringify(result.toolCalls, null, 2));
