// Checkpoint 3: run the standup pipeline directly — no agent involved.
// Watch each step fire in the fixed order the workflow definition sets, not
// whatever order a model might improvise.
//
// Usage: npx tsx scripts/run-standup.ts

import { mastra } from '../src/mastra';

const workflow = mastra.getWorkflow('standupWorkflow');
const run = await workflow.createRun();

const result = await run.start({
  inputData: { userId: process.env.TEST_USER_ID || 'demo-user', now: new Date().toISOString() },
});

console.log(`status: ${result.status}\n`);
if (result.status === 'success') {
  console.log(result.result.summary);
}
